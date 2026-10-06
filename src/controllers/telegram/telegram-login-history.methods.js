import { escapeHtml } from "../../utils/core.js";
import { formatOptionalSystemDateTime } from "../../utils/datetime.js";

const LOGIN_HISTORY_PAGE_SIZE = 4;
const LOGIN_HISTORY_RESULTS = new Set(["all", "success", "failure", "locked"]);

function normalizeResult(value) {
	const result = String(value || "all").trim().toLowerCase();
	return LOGIN_HISTORY_RESULTS.has(result) ? result : "all";
}

function clampPage(page, total) {
	const pages = Math.max(1, Math.ceil(Number(total || 0) / LOGIN_HISTORY_PAGE_SIZE));
	return Math.min(Math.max(0, Number(page) || 0), pages - 1);
}

function bounded(value, limit = 120, fallback = "—") {
	const text = String(value ?? "").trim();
	return (text || fallback).slice(0, limit);
}

function resultIcon(result) {
	switch (result) {
		case "success":
			return "🟢";
		case "failure":
			return "🟠";
		case "locked":
			return "🔴";
		default:
			return "⚪";
	}
}

function resultLabel(result, en) {
	const labels = en
		? { success: "Success", failure: "Failed", locked: "Locked" }
		: { success: "موفق", failure: "ناموفق", locked: "قفل‌شده" };
	return labels[result] || String(result || "unknown");
}

function filterLabel(result, en) {
	if (result === "all") return en ? "All" : "همه";
	return resultLabel(result, en);
}

function reasonLabel(reason, en) {
	const labels = en
		? {
			authenticated: "Authenticated",
			invalid_credentials: "Invalid credentials",
			invalid_credentials_lockout: "Locked after invalid attempts",
			rate_limited: "Rate limited",
		}
		: {
			authenticated: "ورود موفق",
			invalid_credentials: "اطلاعات ورود نامعتبر",
			invalid_credentials_lockout: "قفل پس از تلاش‌های نامعتبر",
			rate_limited: "محدودشده به‌دلیل تعداد تلاش",
		};
	return labels[reason] || bounded(reason, 80, en ? "Unknown" : "نامشخص");
}

function locationText(event) {
	const city = String(event.city || "").trim();
	const country = String(event.country || "").trim();
	const region = String(event.region || "").trim();
	const parts = city && country ? [city, country] : [city, region, country].filter(Boolean);
	return parts.length ? parts.join(" · ") : "—";
}

function userAgentLabel(value) {
	const ua = bounded(value, 512, "");
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
	return summary.length ? summary.join(" · ") : bounded(ua, 100);
}

function filteredTotal(stats, result) {
	if (result === "all") return Number(stats?.total || 0);
	return Number(stats?.[result] || 0);
}

function filterKeyboard(en, active) {
	const filters = [
		["all", en ? "All" : "همه"],
		["success", en ? "Success" : "موفق"],
		["failure", en ? "Failed" : "ناموفق"],
		["locked", en ? "Locked" : "قفل‌شده"],
	];
	return [
		filters.slice(0, 2).map(([result, label]) => ({
			text: `${result === active ? "✅" : "▫️"} ${label}`,
			callback_data: `security:logins:${result}:0`,
		})),
		filters.slice(2).map(([result, label]) => ({
			text: `${result === active ? "✅" : "▫️"} ${label}`,
			callback_data: `security:logins:${result}:0`,
		})),
	];
}

function eventLines(event, en) {
	const result = String(event.result || "unknown");
	const username = bounded(event.username, 64);
	const reason = reasonLabel(String(event.reason || ""), en);
	return [
		`${resultIcon(result)} <b>${escapeHtml(username)}</b> · ${escapeHtml(reason)}`,
		`🕒 <code>${escapeHtml(formatOptionalSystemDateTime(this.s.config, event.createdAt))}</code>`,
		`📍 ${escapeHtml(bounded(locationText(event), 140))} · <code>${escapeHtml(bounded(event.ipAddress, 128))}</code>`,
		`💻 ${escapeHtml(userAgentLabel(event.userAgent))}`,
	];
}

export const telegram_loginHistoryMethods = {
	async _showLoginHistory(message, admin, { result = "all", page = 0 } = {}) {
		if (admin.role !== "owner") return this._showLoginHistoryOwnerRequired(message);
		const en = this._tgLanguage() === "en";
		const filter = normalizeResult(result);
		const stats = await this.s.loginHistory.stats();
		const total = filteredTotal(stats, filter);
		const safePage = clampPage(page, total);
		const pages = Math.max(1, Math.ceil(total / LOGIN_HISTORY_PAGE_SIZE));
		const rows = await this.s.loginHistory.list({
			limit: LOGIN_HISTORY_PAGE_SIZE,
			offset: safePage * LOGIN_HISTORY_PAGE_SIZE,
			result: filter === "all" ? null : filter,
		});

		const lines = [
			`<b>🛡 ${en ? "Web Admin Login Security" : "امنیت ورود Web Admin"}</b>`,
			"",
			`🟢 <b>${Number(stats.success || 0)}</b> · 🟠 <b>${Number(stats.failure || 0)}</b> · 🔴 <b>${Number(stats.locked || 0)}</b>`,
			`${en ? "Filter" : "فیلتر"}: <b>${escapeHtml(filterLabel(filter, en))}</b> · ${en ? "Page" : "صفحه"} <b>${safePage + 1}/${pages}</b>`,
		];

		if (!rows.length) {
			lines.push(
				"",
				`<blockquote>${en ? "No login events match this filter." : "رویدادی برای این فیلتر وجود ندارد."}</blockquote>`,
			);
		} else {
			for (const event of rows) {
				lines.push("", ...eventLines.call(this, event, en));
			}
		}

		const keyboard = filterKeyboard(en, filter);
		if (pages > 1) {
			const navigation = [];
			if (safePage > 0) {
				navigation.push({
					text: "⬅️",
					callback_data: `security:logins:${filter}:${safePage - 1}`,
				});
			}
			navigation.push({
				text: `${safePage + 1}/${pages}`,
				callback_data: `security:logins:${filter}:${safePage}`,
			});
			if (safePage + 1 < pages) {
				navigation.push({
					text: "➡️",
					callback_data: `security:logins:${filter}:${safePage + 1}`,
				});
			}
			keyboard.push(navigation);
		}
		keyboard.push([
			{
				text: en ? "🔄 Refresh" : "🔄 بروزرسانی",
				callback_data: `security:logins:${filter}:${safePage}`,
			},
		]);
		keyboard.push([
			{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" },
		]);

		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			lines.join("\n"),
			{ inline_keyboard: keyboard },
		);
	},

	async _showLoginHistoryOwnerRequired(message) {
		const en = this._tgLanguage() === "en";
		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			`<b>🔒 ${en ? "Owner access required" : "دسترسی Owner لازم است"}</b>\n\n${
				en
					? "Web Admin login history is available only to the bot owner."
					: "تاریخچه ورود Web Admin فقط برای Owner ربات قابل مشاهده است."
			}`,
			{
				inline_keyboard: [
					[{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" }],
				],
			},
		);
	},
};

export { LOGIN_HISTORY_PAGE_SIZE };
