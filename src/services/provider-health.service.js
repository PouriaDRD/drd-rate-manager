import { SOURCE_NAMES } from "./source-settings.service.js";

export const PROVIDER_HEALTH_SCORE_VERSION = 1;

const GRADE_THRESHOLDS = Object.freeze([
	Object.freeze({ min: 85, grade: "excellent" }),
	Object.freeze({ min: 65, grade: "healthy" }),
	Object.freeze({ min: 40, grade: "degraded" }),
	Object.freeze({ min: 0, grade: "unhealthy" }),
]);

export function providerHealthGrade(score) {
	if (score == null) return "disabled";
	const normalized = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
	return GRADE_THRESHOLDS.find((item) => normalized >= item.min)?.grade || "unhealthy";
}

export function providerHealthScore({
	enabled = true,
	status = null,
	circuit = null,
	now = Date.now(),
} = {}) {
	if (!enabled) return null;

	const checkedAt = Number(status?.lastCheckedAt || status?.last_checked_at || 0);
	const checked = checkedAt > 0;
	let score;

	if (!checked) {
		score = 50;
	} else if (status?.success === true) {
		score = 100 - latencyPenalty(status?.latency);
		score -= stalePenalty(now - checkedAt);
	} else {
		score = failureBase(status?.status);
		score -= stalePenalty(now - checkedAt, 0.5);
	}

	switch (circuit?.state) {
		case "open":
			score = Math.min(score, 15);
			break;
		case "probe_in_progress":
			score = Math.min(score, 35);
			break;
		case "half_open_ready":
			score = Math.min(score, 45);
			break;
		case "unknown":
			score = Math.min(score, 55);
			break;
		default:
			break;
	}

	return Math.max(0, Math.min(100, Math.round(score)));
}

function latencyPenalty(value) {
	const latency = Number(value);
	if (!Number.isFinite(latency) || latency < 0) return 5;
	if (latency <= 250) return 0;
	if (latency <= 750) return 5;
	if (latency <= 1500) return 10;
	if (latency <= 3000) return 20;
	return 30;
}

function stalePenalty(ageMs, multiplier = 1) {
	if (!Number.isFinite(ageMs) || ageMs <= 5 * 60_000) return 0;
	if (ageMs <= 15 * 60_000) return Math.round(5 * multiplier);
	if (ageMs <= 60 * 60_000) return Math.round(15 * multiplier);
	return Math.round(30 * multiplier);
}

function failureBase(status) {
	const code = Number(status);
	if (code === 401 || code === 403 || code === 429) return 10;
	if (Number.isFinite(code) && code >= 500) return 20;
	return 25;
}

function checkedAt(item) {
	return Number(
		item?.status?.lastCheckedAt ||
			item?.status?.last_checked_at ||
			0,
	);
}

function providerGroup(name, items, priority = []) {
	const enabled = items.filter((item) => item.enabled);
	const checked = enabled.filter((item) => checkedAt(item) > 0);
	const healthy = checked.filter((item) => item.status?.success === true);
	const failed = checked.filter((item) => item.status?.success === false);
	const candidateScores = healthy
		.map((item) => item.health?.score)
		.filter((score) => Number.isFinite(score));
	const fallbackScores = enabled
		.map((item) => item.health?.score)
		.filter((score) => Number.isFinite(score));
	const score = candidateScores.length
		? Math.max(...candidateScores)
		: fallbackScores.length
			? Math.max(...fallbackScores)
			: null;
	const orderedNames = priority.length
		? priority
		: enabled.map((item) => item.name);
	const activeSource =
		orderedNames.find((source) =>
			healthy.some((item) => item.name === source),
		) ||
		healthy[0]?.name ||
		null;

	return {
		name,
		enabled: enabled.length,
		checked: checked.length,
		healthy: healthy.length,
		failed: failed.length,
		unchecked: enabled.length - checked.length,
		available: healthy.length > 0,
		activeSource,
		score,
		grade: providerHealthGrade(score),
	};
}

export class ProviderHealthService {
	constructor(sourceSettings, resilience) {
		this.sourceSettings = sourceSettings;
		this.resilience = resilience;
	}

	async snapshot(now = Date.now()) {
		const [sourceSnapshot, circuits] = await Promise.all([
			this.sourceSettings.snapshot(),
			this.resilience.inspectAll(SOURCE_NAMES, now),
		]);

		const sources = {};
		for (const name of SOURCE_NAMES) {
			const item = sourceSnapshot.sources?.[name] || {
				name,
				label: name,
				kind: "unknown",
				enabled: false,
				status: null,
			};
			const circuit = circuits[name] || {
				source: name,
				state: "unknown",
				retryAt: 0,
				remainingMs: 0,
				error: "Circuit diagnostics unavailable",
			};
			const score = providerHealthScore({
				enabled: Boolean(item.enabled),
				status: item.status,
				circuit,
				now,
			});
			sources[name] = {
				...item,
				health: {
					score,
					grade: providerHealthGrade(score),
					circuit,
					checked: Number(
						item.status?.lastCheckedAt ||
							item.status?.last_checked_at ||
							0,
					) > 0,
				},
			};
		}

		const enabled = Object.values(sources).filter((item) => item.enabled);
		const numericScores = enabled
			.map((item) => item.health.score)
			.filter((score) => Number.isFinite(score));
		const fleetScore = numericScores.length
			? Math.round(
				numericScores.reduce((total, value) => total + value, 0) /
					numericScores.length,
			)
			: null;

		const priority = Array.isArray(sourceSnapshot.usdt_priority)
			? sourceSnapshot.usdt_priority
			: [];
		const groups = {
			usdt: providerGroup(
				"usdt",
				Object.values(sources).filter((item) => item.kind === "usdt"),
				priority,
			),
			market: providerGroup(
				"market",
				Object.values(sources).filter((item) => item.kind === "market"),
			),
			gold: providerGroup(
				"gold",
				Object.values(sources).filter((item) => item.kind === "gold"),
			),
		};
		const groupScores = Object.values(groups)
			.filter((group) => group.enabled > 0)
			.map((group) => group.score)
			.filter((score) => Number.isFinite(score));
		const score = groupScores.length
			? Math.round(
				groupScores.reduce((total, value) => total + value, 0) /
					groupScores.length,
			)
			: null;

		return {
			...sourceSnapshot,
			sources,
			provider_health: {
				version: PROVIDER_HEALTH_SCORE_VERSION,
				score,
				grade: providerHealthGrade(score),
				fleetScore,
				fleetGrade: providerHealthGrade(fleetScore),
				groups,
				openCircuits: enabled.filter((item) => item.health.circuit.state === "open").length,
				probes: enabled.filter((item) =>
					["probe_in_progress", "half_open_ready"].includes(item.health.circuit.state),
				).length,
				unknownCircuits: enabled.filter((item) => item.health.circuit.state === "unknown").length,
			},
		};
	}
}
