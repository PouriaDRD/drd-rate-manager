import { escapeHtml, errorMessage } from "../utils/core.js";

export const OPERATIONAL_ALERT_REMINDER_MS = 6 * 60 * 60 * 1000;

const ACTIONABLE_DEGRADED_REASONS = Object.freeze([
	"no_sources_enabled",
	"source_failures",
	"provider_circuit_open",
	"operational_metrics_unavailable",
]);

const ACTIONABLE_DEGRADED_REASON_SET = new Set(
	ACTIONABLE_DEGRADED_REASONS,
);

const LABELS = Object.freeze({
	en: Object.freeze({
		database_unavailable: "Database unavailable",
		runtime_integrity_failed: "Runtime integrity failed",
		runtime_settings_invalid: "Invalid runtime settings",
		no_sources_enabled: "No market sources are enabled",
		source_failures: "One or more market providers are failing",
		provider_circuit_open: "A provider circuit is open",
		cache_empty: "Market cache is empty",
		cache_expired: "Market cache is expired",
		cache_last_error: "Market cache reports an error",
		operational_metrics_unavailable: "Operational metrics are unavailable",
	}),
	fa: Object.freeze({
		database_unavailable: "دیتابیس در دسترس نیست",
		runtime_integrity_failed: "سلامت Runtime تأیید نشد",
		runtime_settings_invalid: "تنظیمات Runtime نامعتبر است",
		no_sources_enabled: "هیچ منبع بازار فعالی وجود ندارد",
		source_failures: "یک یا چند Provider بازار دچار خطا هستند",
		provider_circuit_open: "Circuit یکی از Providerها باز است",
		cache_empty: "کش بازار خالی است",
		cache_expired: "کش بازار منقضی شده",
		cache_last_error: "کش بازار خطا گزارش می‌کند",
		operational_metrics_unavailable: "متریک‌های عملیاتی در دسترس نیستند",
	}),
});

function stableReasons(values) {
	return [...new Set((values || []).map(String).filter(Boolean))].sort();
}

export function operationalAlertCandidate(snapshot = {}) {
	const health = snapshot.health || {};
	const status = String(health.status || "unknown");

	if (status === "disabled" || status === "healthy") return null;

	if (status === "critical") {
		const reasons = stableReasons(
			health.critical?.length ? health.critical : health.reasonCodes,
		);
		if (!reasons.length) return null;
		return {
			severity: "critical",
			reasons,
			fingerprint: `critical:${reasons.join(",")}`,
		};
	}

	if (status === "degraded") {
		const warnings = stableReasons(
			health.warnings?.length ? health.warnings : health.reasonCodes,
		).filter((reason) => ACTIONABLE_DEGRADED_REASON_SET.has(reason));
		if (!warnings.length) return null;
		return {
			severity: "degraded",
			reasons: warnings,
			fingerprint: `degraded:${warnings.join(",")}`,
		};
	}

	return null;
}

function reasonLabel(reason, language) {
	const labels = LABELS[language] || LABELS.fa;
	return labels[reason] || reason;
}

function stateSummary(state, configured, available, error = null) {
	return {
		configured,
		available,
		active: Boolean(state?.active),
		fingerprint: state?.fingerprint || null,
		severity: state?.severity || null,
		reasons: Array.isArray(state?.reasons) ? state.reasons : [],
		firstSentAt: Number(state?.firstSentAt || 0),
		lastSentAt: Number(state?.lastSentAt || 0),
		recoveredAt: Number(state?.recoveredAt || 0),
		error: error || null,
	};
}

function bounded(value, limit = 120) {
	return String(value ?? "").trim().slice(0, limit);
}

function affectedProviders(snapshot = {}) {
	const items = Array.isArray(snapshot.sources?.items) ? snapshot.sources.items : [];
	return items
		.filter(
			(item) =>
				item?.enabled &&
				(item.healthy === false || String(item.circuitState || "") === "open"),
		)
		.slice(0, 5);
}

function providerLine(item, language) {
	const en = language === "en";
	const label = bounded(item.label || item.name || "Provider", 48);
	const details = [];

	if (item.status != null) details.push(String(item.status));
	if (item.message) details.push(bounded(item.message, 90));
	if (String(item.circuitState || "") === "open") {
		details.push(en ? "circuit open" : "Circuit باز");
	}

	const detail = details.length ? details.join(" · ") : en ? "Unavailable" : "در دسترس نیست";
	return `• <b>${escapeHtml(label)}</b>\n  <code>${escapeHtml(detail)}</code>`;
}

export class OperationalAlertService {
	constructor(config, telegram, preferences, repository) {
		this.config = config;
		this.telegram = telegram;
		this.preferences = preferences;
		this.repository = repository;
	}

	async status() {
		const configured = Boolean(this.config.ownerId);
		try {
			const state = await this.repository.get();
			return stateSummary(state, configured, true);
		} catch (error) {
			return stateSummary(
				null,
				configured,
				false,
				errorMessage(error).slice(0, 500),
			);
		}
	}

	async evaluate(snapshot, now = Date.now()) {
		const ownerId = String(this.config.ownerId || "").trim();
		if (!ownerId) {
			return {
				action: "skipped",
				reason: "owner_missing",
				sent: false,
			};
		}

		let state;
		try {
			state = await this.repository.get();
		} catch (error) {
			return {
				action: "skipped",
				reason: "state_unavailable",
				sent: false,
				error: errorMessage(error).slice(0, 500),
			};
		}

		if (String(snapshot.health?.status || "") === "disabled") {
			return {
				action: "suppressed",
				reason: "system_disabled",
				sent: false,
			};
		}

		const candidate = operationalAlertCandidate(snapshot);
		if (!candidate) {
			if (!state.active) {
				return { action: "none", reason: "healthy", sent: false };
			}
			return this.#recover(ownerId, state, snapshot, now);
		}

		const sameFingerprint =
			state.active && state.fingerprint === candidate.fingerprint;
		if (
			sameFingerprint &&
			now - Number(state.lastSentAt || 0) < OPERATIONAL_ALERT_REMINDER_MS
		) {
			return {
				action: "suppressed",
				reason: "deduplicated",
				sent: false,
				fingerprint: candidate.fingerprint,
			};
		}

		const reminder = sameFingerprint;
		return this.#alert(
			ownerId,
			state,
			candidate,
			snapshot,
			now,
			reminder,
		);
	}

	async #alert(ownerId, state, candidate, snapshot, now, reminder) {
		const language = this.preferences.telegramLanguage === "en" ? "en" : "fa";
		const text = this.#alertMessage(candidate, snapshot, language, reminder);
		try {
			await this.telegram.sendMessage(ownerId, text);
		} catch (error) {
			return {
				action: "failed",
				reason: "telegram_send_failed",
				sent: false,
				error: errorMessage(error).slice(0, 500),
				fingerprint: candidate.fingerprint,
			};
		}

		const firstSentAt =
			state.active && state.fingerprint === candidate.fingerprint
				? Number(state.firstSentAt || now)
				: now;
		await this.repository.set({
			active: true,
			fingerprint: candidate.fingerprint,
			severity: candidate.severity,
			reasons: candidate.reasons,
			firstSentAt,
			lastSentAt: now,
			recoveredAt: Number(state.recoveredAt || 0),
		});
		return {
			action: reminder ? "reminder" : "alert",
			reason: candidate.severity,
			sent: true,
			fingerprint: candidate.fingerprint,
		};
	}

	async #recover(ownerId, state, snapshot, now) {
		const language = this.preferences.telegramLanguage === "en" ? "en" : "fa";
		const text = this.#recoveryMessage(state, snapshot, language);
		try {
			await this.telegram.sendMessage(ownerId, text);
		} catch (error) {
			return {
				action: "failed",
				reason: "telegram_recovery_failed",
				sent: false,
				error: errorMessage(error).slice(0, 500),
				fingerprint: state.fingerprint || null,
			};
		}

		await this.repository.set({
			active: false,
			fingerprint: null,
			severity: null,
			reasons: [],
			firstSentAt: 0,
			lastSentAt: Number(state.lastSentAt || 0),
			recoveredAt: now,
		});
		return {
			action: "recovery",
			reason: "healthy",
			sent: true,
		};
	}

	#alertMessage(candidate, snapshot, language, reminder) {
		const en = language === "en";
		const critical = candidate.severity === "critical";
		const icon = critical ? "🔴" : "🟡";
		const title = reminder
			? en
				? "Operational alert reminder"
				: "یادآوری هشدار عملیاتی"
			: en
				? "Operational alert"
				: "هشدار عملیاتی";

		const score = snapshot.sources?.healthScore;
		const openCircuits = Number(snapshot.sources?.openCircuits || 0);
		const healthy = Number(snapshot.sources?.healthy || 0);
		const failed = Number(snapshot.sources?.failed || 0);
		const providers = affectedProviders(snapshot);

		const lines = [
			`<b>${icon} ${title}</b>`,
			"",
			`<b>${escapeHtml(candidate.severity.toUpperCase())}</b>`,
		];

		const summary = [];
		if (score != null) summary.push(`Provider <code>${Number(score)}/100</code>`);
		if (openCircuits) {
			summary.push(
				en
					? `<code>${openCircuits}</code> open circuit`
					: `<code>${openCircuits}</code> Circuit باز`,
			);
		}
		if (healthy || failed) {
			summary.push(
				en
					? `<code>${healthy}</code> healthy · <code>${failed}</code> failed`
					: `<code>${healthy}</code> سالم · <code>${failed}</code> خطادار`,
			);
		}
		if (summary.length) lines.push(summary.join(" · "));

		if (providers.length) {
			lines.push(
				"",
				`<b>${en ? "Affected providers" : "منابع درگیر"}</b>`,
				...providers.map((item) => providerLine(item, language)),
			);
		}

		lines.push(
			"",
			`<b>${en ? "Why this alert was sent" : "علت هشدار"}</b>`,
			...candidate.reasons.map(
				(reason) => `• ${escapeHtml(reasonLabel(reason, language))}`,
			),
		);

		if (
			candidate.reasons.some((reason) =>
				["cache_empty", "cache_expired", "cache_last_error"].includes(reason),
			)
		) {
			const cacheDetail = snapshot.cache?.lastError
				? bounded(snapshot.cache.lastError, 100)
				: en
					? "Expired"
					: "منقضی شده";
			lines.push(
				"",
				`🗄 ${en ? "Cache" : "کش"} · <code>${escapeHtml(cacheDetail)}</code>`,
			);
		}

		return lines.join("\n").slice(0, 3900);
	}

	#recoveryMessage(state, snapshot, language) {
		const en = language === "en";
		const fullyHealthy = String(snapshot.health?.status || "") === "healthy";
		const title = fullyHealthy
			? en
				? "System recovered"
				: "سیستم به وضعیت عادی برگشت"
			: en
				? "Operational alert cleared"
				: "هشدار عملیاتی رفع شد";

		const score = snapshot.sources?.healthScore;
		const lines = [
			`<b>🟢 ${title}</b>`,
			"",
			en
				? "The previous operational condition is no longer active."
				: "شرایط هشدار قبلی دیگر فعال نیست.",
		];

		if (score != null) {
			lines.push(`Provider <code>${Number(score)}/100</code>`);
		}

		return lines.join("\n").slice(0, 3900);
	}
}

export const OPERATIONAL_ALERT_ACTIONABLE_WARNINGS =
	ACTIONABLE_DEGRADED_REASONS;
