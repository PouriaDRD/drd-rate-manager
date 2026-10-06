import { escapeHtml, errorMessage } from "../utils/core.js";
import { formatOptionalSystemDateTime } from "../utils/datetime.js";
import {
	WEB_LOGIN_RESULTS,
	webLoginRequestMetadata,
} from "./login-history.service.js";

const LOCKOUT_ALERT_REASONS = new Set(["invalid_credentials_lockout"]);

const COPY = Object.freeze({
	fa: Object.freeze({
		successTitle: "ورود موفق به Web Admin",
		lockedTitle: "هشدار امنیتی Web Admin",
		securityContext: "جزئیات امنیتی",
		authenticated: "احراز هویت با موفقیت انجام شد.",
		invalid_credentials_lockout: "تعداد تلاش‌های ناموفق به حد قفل رسید.",
		successWarning: "اگر این ورود برای شما نیست، دسترسی Web Admin را فوراً بررسی کنید.",
		lockedWarning: "دسترسی این IP و نام کاربری موقتاً قفل شده است.",
		session: "Session",
		cfRay: "CF-Ray",
		asn: "ASN",
	}),
	en: Object.freeze({
		successTitle: "Web Admin login",
		lockedTitle: "Web Admin security alert",
		securityContext: "Security details",
		authenticated: "Authentication completed successfully.",
		invalid_credentials_lockout: "The failed-attempt threshold was reached.",
		successWarning: "If this login was not yours, review Web Admin access immediately.",
		lockedWarning: "Access for this IP and username is temporarily locked.",
		session: "Session",
		cfRay: "CF-Ray",
		asn: "ASN",
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
	const city = boundedText(metadata.city, 96);
	const country = boundedText(metadata.country, 32);
	const region = boundedText(metadata.region, 96);
	const values = city && country ? [city, country] : [city, region, country].filter(Boolean);
	return values.length ? values.join(" · ") : "—";
}

function userAgentLabel(value) {
	const ua = boundedText(value, 512);
	if (!ua) return "—";

	let os = "";
	if (/Windows NT/i.test(ua)) os = "Windows";
	else if (/Android/i.test(ua)) os = "Android";
	else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
	else if (/Macintosh|Mac OS X/i.test(ua)) os = "macOS";
	else if (/Linux/i.test(ua)) os = "Linux";

	let client = "";
	const powershell = ua.match(/WindowsPowerShell\/([\d.]+)/i);
	const edge = ua.match(/Edg\/([\d.]+)/i);
	const chrome = ua.match(/Chrome\/([\d.]+)/i);
	const firefox = ua.match(/Firefox\/([\d.]+)/i);
	const safari = ua.match(/Version\/([\d.]+).*Safari/i);
	const curl = ua.match(/curl\/([\d.]+)/i);

	if (powershell) client = `PowerShell ${powershell[1].split(".").slice(0, 2).join(".")}`;
	else if (edge) client = `Edge ${edge[1].split(".")[0]}`;
	else if (chrome) client = `Chrome ${chrome[1].split(".")[0]}`;
	else if (firefox) client = `Firefox ${firefox[1].split(".")[0]}`;
	else if (safari) client = `Safari ${safari[1].split(".")[0]}`;
	else if (curl) client = `curl ${curl[1]}`;

	const summary = [os, client].filter(Boolean);
	return summary.length ? summary.join(" · ") : boundedText(ua, 110, "Unknown client");
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
		const summary = success ? copy.authenticated : reasonLabel(event.reason, language);

		const lines = [
			`<b>${icon} ${title}</b>`,
			"",
			`<blockquote>${escapeHtml(summary)}</blockquote>`,
			"",
			`👤 <code>${escapeHtml(event.username)}</code>`,
			`📍 ${escapeHtml(locationLabel(metadata))}`,
			`🕒 <code>${formatOptionalSystemDateTime(this.config, event.createdAt)}</code>`,
			`💻 ${escapeHtml(userAgentLabel(metadata.userAgent))}`,
			`🌐 <code>${escapeHtml(metadata.ipAddress || "unknown")}</code>`,
		];

		const security = [];
		if (success && event.sessionRef) {
			security.push(
				`${copy.session} · <code>${escapeHtml(event.sessionRef)}</code>`,
			);
		}
		if (metadata.cfRay) {
			security.push(
				`${copy.cfRay} · <code>${escapeHtml(boundedText(metadata.cfRay, 64))}</code>`,
			);
		}
		if (metadata.asn != null) {
			security.push(`${copy.asn} · <code>${escapeHtml(String(metadata.asn))}</code>`);
		}

		if (!success) {
			security.push(`<code>${escapeHtml(event.reason)}</code>`);
		}

		if (security.length) {
			lines.push("", `<b>${copy.securityContext}</b>`, ...security);
		}

		lines.push(
			"",
			`⚠️ ${escapeHtml(success ? copy.successWarning : copy.lockedWarning)}`,
		);

		return lines.join("\n").slice(0, 3900);
	}
}
