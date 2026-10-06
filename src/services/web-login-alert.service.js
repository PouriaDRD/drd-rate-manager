import { escapeHtml, errorMessage } from "../utils/core.js";
import {
	WEB_LOGIN_RESULTS,
	webLoginRequestMetadata,
} from "./login-history.service.js";

const LOCKOUT_ALERT_REASONS = new Set(["invalid_credentials_lockout"]);

const COPY = Object.freeze({
	fa: Object.freeze({
		successTitle: "ورود موفق به Web Admin",
		lockedTitle: "هشدار امنیتی Web Admin",
		username: "کاربر",
		status: "وضعیت",
		reason: "دلیل",
		ip: "IP",
		location: "موقعیت",
		time: "زمان",
		userAgent: "User-Agent",
		sessionRef: "Session ref",
		securityContext: "جزئیات امنیتی",
		authenticated: "احراز هویت موفق",
		invalid_credentials_lockout: "تعداد تلاش ناموفق به حد قفل رسید",
		successWarning: "اگر این ورود متعلق به شما نیست، دسترسی Web Admin را فوراً بررسی کنید.",
		lockedWarning: "تلاش‌های ورود این IP و نام کاربری به‌صورت موقت قفل شدند.",
	}),
	en: Object.freeze({
		successTitle: "Web Admin login",
		lockedTitle: "Web Admin security alert",
		username: "Username",
		status: "Status",
		reason: "Reason",
		ip: "IP",
		location: "Location",
		time: "Time",
		userAgent: "User-Agent",
		sessionRef: "Session ref",
		securityContext: "Security context",
		authenticated: "Authentication succeeded",
		invalid_credentials_lockout: "Failed-attempt threshold reached",
		successWarning: "If this login was not yours, review Web Admin access immediately.",
		lockedWarning: "Login attempts for this IP and username are temporarily locked.",
	}),
});

function boundedText(value, maxLength, fallback = "") {
	const text = String(value ?? fallback).trim();
	return text.slice(0, maxLength);
}

function normalizeEvent(event = {}) {
	return {
		username: boundedText(event.username, 128, "unknown") || "unknown",
		result: boundedText(event.result, 32).toLowerCase(),
		reason: boundedText(event.reason, 128, "unknown") || "unknown",
		sessionRef: boundedText(event.sessionRef, 32),
		createdAt: Number.isFinite(Number(event.createdAt))
			? Number(event.createdAt)
			: Date.now(),
	};
}

export function webLoginAlertDecision(event = {}) {
	const normalized = normalizeEvent(event);
	if (normalized.result === WEB_LOGIN_RESULTS.SUCCESS) {
		return { notify: true, kind: "success", event: normalized };
	}
	if (normalized.result === WEB_LOGIN_RESULTS.LOCKED) {
		if (LOCKOUT_ALERT_REASONS.has(normalized.reason)) {
			return { notify: true, kind: "locked", event: normalized };
		}
		return {
			notify: false,
			kind: "locked",
			reason: "lockout_already_active",
			event: normalized,
		};
	}
	if (normalized.result === WEB_LOGIN_RESULTS.FAILURE) {
		return {
			notify: false,
			kind: "failure",
			reason: "non_actionable_failure",
			event: normalized,
		};
	}
	return {
		notify: false,
		kind: "unknown",
		reason: "unsupported_result",
		event: normalized,
	};
}

function reasonLabel(reason, language) {
	const copy = COPY[language] || COPY.fa;
	return copy[reason] || reason;
}

function locationLabel(metadata) {
	const values = [metadata.city, metadata.region, metadata.country]
		.map((value) => boundedText(value, 128))
		.filter(Boolean);
	return values.length ? values.join(", ") : "—";
}

function securityContext(metadata) {
	const parts = [];
	if (metadata.cfRay) parts.push(`CF-Ray ${metadata.cfRay}`);
	if (metadata.asn != null) parts.push(`ASN ${metadata.asn}`);
	if (metadata.timezone) parts.push(metadata.timezone);
	return parts.length ? parts.join(" · ") : "—";
}

export class WebLoginAlertService {
	constructor(config, telegram, preferences) {
		this.config = config;
		this.telegram = telegram;
		this.preferences = preferences;
	}

	async notify(request, event = {}) {
		const ownerId = String(this.config?.ownerId || "").trim();
		if (!ownerId) {
			return { action: "skipped", reason: "owner_missing", sent: false };
		}

		const decision = webLoginAlertDecision(event);
		if (!decision.notify) {
			return {
				action: "skipped",
				reason: decision.reason,
				sent: false,
			};
		}

		try {
			await this.preferences?.refresh?.();
		} catch {
			// Notification remains best-effort and falls back to cached/default language.
		}

		const language = this.preferences?.telegramLanguage === "en" ? "en" : "fa";
		const metadata = webLoginRequestMetadata(request);
		const text = this.#message(decision.kind, decision.event, metadata, language);

		try {
			await this.telegram.sendMessage(ownerId, text);
		} catch (error) {
			return {
				action: "failed",
				reason: "telegram_send_failed",
				sent: false,
				error: errorMessage(error).slice(0, 500),
			};
		}

		return {
			action: "sent",
			reason: decision.kind,
			sent: true,
		};
	}

	#message(kind, event, metadata, language) {
		const copy = COPY[language] || COPY.fa;
		const success = kind === "success";
		const title = success ? copy.successTitle : copy.lockedTitle;
		const icon = success ? "🟢" : "🔴";
		const lines = [
			`<b>${icon} ${title}</b>`,
			"",
			`${copy.username}: <code>${escapeHtml(event.username)}</code>`,
			`${copy.status}: <b>${escapeHtml(event.result.toUpperCase())}</b>`,
			`${copy.reason}: ${escapeHtml(reasonLabel(event.reason, language))} <code>${escapeHtml(event.reason)}</code>`,
			`${copy.ip}: <code>${escapeHtml(metadata.ipAddress || "unknown")}</code>`,
			`${copy.location}: <code>${escapeHtml(locationLabel(metadata))}</code>`,
			`${copy.time}: <code>${escapeHtml(new Date(event.createdAt).toISOString())}</code>`,
		];

		if (success && event.sessionRef) {
			lines.push(
				`${copy.sessionRef}: <code>${escapeHtml(event.sessionRef)}</code>`,
			);
		}

		if (metadata.userAgent) {
			lines.push(
				`${copy.userAgent}: <code>${escapeHtml(boundedText(metadata.userAgent, 512))}</code>`,
			);
		}

		lines.push(
			`${copy.securityContext}: <code>${escapeHtml(securityContext(metadata))}</code>`,
			"",
			`<b>${success ? copy.successWarning : copy.lockedWarning}</b>`,
		);


		return lines.join("\n").slice(0, 3900);
	}
}
