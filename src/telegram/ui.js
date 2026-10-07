import { USDT_SOURCE_PRIORITY } from "../config/app.js";
import { resolveUsdtChecks } from "../services/market-support.js";
import { escapeHtml, nullableNumber } from "../utils/core.js";

export function resolveUsdtFromStatuses(statuses, enabledSources = USDT_SOURCE_PRIORITY) {
	const enabled = new Set(enabledSources);
	const checks = Object.fromEntries(
		USDT_SOURCE_PRIORITY.map((key) => [
			key,
			enabled.has(key) ? statuses?.[key] : null,
		]),
	);
	const result = resolveUsdtChecks(checks);
	if (result?.success && nullableNumber(result.price) != null) {
		return {
			available: true,
			selected_source: result.sourceLabel,
			price_toman: nullableNumber(result.price),
			fallback_level: null,
			latency_ms: null,
			strategy: "consensus",
			contributors: result.contributors || [],
			rejected: result.rejected || [],
			sample_count: Number(result.sampleCount || 0),
		};
	}
	return {
		available: false,
		selected_source: null,
		price_toman: null,
		fallback_level: null,
		latency_ms: null,
		strategy: "consensus",
		contributors: [],
		rejected: [],
		sample_count: 0,
	};
}

export function sourceStatusText(label, status, role = null) {
	const prefix = status?.success ? "🟢" : "🔴";
	const parts = [
		`${prefix} <b>${escapeHtml(label)}</b>${role ? ` · <code>${escapeHtml(role)}</code>` : ""}`,
	];
	if (status?.status != null) parts.push(`HTTP: <code>${status.status}</code>`);
	if (status?.latency != null) parts.push(`Latency: <code>${status.latency}ms</code>`);
	if (status?.message) parts.push(`<code>${escapeHtml(String(status.message).slice(0, 180))}</code>`);
	return parts.join("\n");
}

export function backKeyboard(label, callback) {
	return { inline_keyboard: [[{ text: `⬅️ ${label}`, callback_data: callback }]] };
}

export function normalizeCommand(text) {
	const first = String(text || "").trim().split(/\s+/)[0].toLowerCase();
	if (!first.startsWith("/")) return "";
	return first.replace(/@[^\s]+$/, "");
}
