import { escapeHtml, errorMessage } from "../utils/core.js";

export const OPERATIONAL_ALERT_REMINDER_MS = 6 * 60 * 60 * 1000;

const ACTIONABLE_DEGRADED_REASONS = Object.freeze([
	"no_sources_enabled",
	"source_failures",
	"provider_circuit_open",
	"cache_empty",
	"cache_expired",
	"cache_last_error",
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
		no_sources_enabled: "No market sources enabled",
		source_failures: "Provider/source failures detected",
		provider_circuit_open: "Provider circuit open",
		cache_empty: "Market cache empty",
		cache_expired: "Market cache expired",
		cache_last_error: "Market cache reports an error",
		operational_metrics_unavailable: "Operational metrics unavailable",
	}),
	fa: Object.freeze({
		database_unavailable: "دیتابیس در دسترس نیست",
		runtime_integrity_failed: "Runtime integrity ناموفق است",
		runtime_settings_invalid: "تنظیم Runtime نامعتبر است",
		no_sources_enabled: "هیچ منبع بازار فعالی وجود ندارد",
		source_failures: "خرابی منبع یا Provider شناسایی شد",
		provider_circuit_open: "Circuit یک Provider باز است",
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
		const icon = candidate.severity === "critical" ? "🔴" : "🟡";
		const title = reminder
			? en
				? "Operational alert reminder"
				: "یادآوری هشدار عملیاتی"
			: en
				? "Operational alert"
				: "هشدار عملیاتی";
		const lines = [
			`<b>${icon} ${title}</b>`,
			"",
			`${en ? "Status" : "وضعیت"}: <b>${escapeHtml(candidate.severity.toUpperCase())}</b>`,
			`${en ? "System health" : "سلامت سیستم"}: <code>${escapeHtml(snapshot.health?.status || "unknown")}</code>`,
			"",
			`<b>${en ? "Reasons" : "دلایل"}</b>`,
			...candidate.reasons.map(
				(reason) =>
					`• ${escapeHtml(reasonLabel(reason, language))} <code>${escapeHtml(reason)}</code>`,
			),
		];

		const score = snapshot.sources?.healthScore;
		if (score != null) {
			lines.push(
				"",
				`🩺 Provider: <code>${Number(score)}/100</code> · ${Number(snapshot.sources?.openCircuits || 0)} open`,
			);
		}

		return lines.join("\n").slice(0, 3900);
	}

	#recoveryMessage(state, snapshot, language) {
		const en = language === "en";
		const previous = state.reasons?.length
			? state.reasons.map((item) => escapeHtml(item)).join(", ")
			: "—";
		const fullyHealthy = String(snapshot.health?.status || "") === "healthy";
		const title = fullyHealthy
			? en
				? "System recovered"
				: "بازیابی سیستم"
			: en
				? "Operational alert cleared"
				: "رفع هشدار عملیاتی";
		return [
			`<b>🟢 ${title}</b>`,
			"",
			en
				? "The operational alert condition is no longer active."
				: "شرایط هشدار عملیاتی دیگر فعال نیست.",
			`${en ? "Current health" : "سلامت فعلی"}: <code>${escapeHtml(snapshot.health?.status || "healthy")}</code>`,
			`${en ? "Previous reasons" : "دلایل قبلی"}: <code>${previous}</code>`,
		]
			.join("\n")
			.slice(0, 3900);
	}
}

export const OPERATIONAL_ALERT_ACTIONABLE_WARNINGS =
	ACTIONABLE_DEGRADED_REASONS;
