import { APP } from "../../config/app.js";
import { runtimeIntegrity } from "../../app/runtime-integrity.js";
import { databaseStatus } from "../../system/database-status.js";
import { backKeyboard } from "../../telegram/ui.js";
import { escapeHtml, normalizeDigits, parseBoolean } from "../../utils/core.js";
import { formatSystemDate, formatSystemTime } from "../../utils/datetime.js";

export const telegram_systemMethods = {
async _showSystem(message) {
	const [enabled, ttl, automation] = await Promise.all([
		this.s.settings.get("bot_enabled", "1"),
		this.s.market.cacheTtlSeconds(),
		this.s.automation.getSettings(),
	]);
	const en = this._tgLanguage() === "en";
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		[
			`<b>📊 ${en ? "System status" : "وضعیت سیستم"}</b>`, "",
			`<blockquote>${parseBoolean(enabled, true) ? (en ? "🟢 Worker is enabled" : "🟢 Worker فعال است") : (en ? "🔴 Worker is disabled" : "🔴 Worker غیرفعال است")}</blockquote>`, "",
			`Version: <code>${escapeHtml(this.s.config.version)}</code>`,
			`Schema: <code>${APP.schemaVersion}</code>`,
			`Timezone: <code>${escapeHtml(this.s.config.timezone)}</code>`,
			`Cache: <code>${ttl}s</code>`,
			`Automation: <code>${automation.enabled ? "ON" : "OFF"}</code>`,
			`Integrity: <code>${runtimeIntegrity() ? "OK" : "FAILED"}</code>`, "",
			`📅 ${formatSystemDate(this.s.config, Date.now())} · 🕒 ${formatSystemTime(this.s.config, Date.now())}`,
		].join("\n"),
		{ inline_keyboard: [
			[{ text: en ? "🗄 Database status" : "🗄 وضعیت دیتابیس", callback_data: "database:home" }],
			[{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" }],
		] },
	);
},

async _showDatabase(message) {
	const status = await databaseStatus(this.s);
	const storage = status.storage;
	const en = this._tgLanguage() === "en";
	const lines = [
		`<b>🗄 ${en ? "Database status" : "وضعیت دیتابیس"}</b>`, "",
		`<blockquote>${status.connected ? (en ? "🟢 Cloudflare D1 connected" : "🟢 Cloudflare D1 متصل است") : (en ? "🔴 D1 connection failed" : "🔴 اتصال D1 ناموفق است")}</blockquote>`, "",
		`Provider: <code>${escapeHtml(status.provider)}</code>`, `Latency: <code>${status.latency_ms}ms</code>`, "",
		`<b>💾 ${en ? "Database storage" : "فضای دیتابیس"}</b>`, "",
	];
	if (storage.available) {
		lines.push(
			`${storage.bar}  ${storage.percent.toFixed(2)}%`, "",
			`${en ? "Used" : "مصرف‌شده"}: ${storage.used_mb.toFixed(2)} MB`,
			`${en ? "Total" : "فضای کل"}: ${storage.total_mb.toFixed(2)} MB`,
			`${en ? "Remaining" : "باقی‌مانده"}: ${storage.remaining_mb.toFixed(2)} MB`, "",
		);
	}
	lines.push(`<b>📊 ${en ? "Records" : "رکوردها"}</b>`, ...Object.entries(status.records).map(([key, value]) => `${escapeHtml(key)}: <code>${value}</code>`), "", `Schema: <code>${APP.schemaVersion}</code>`);
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), backKeyboard(en ? "System status" : "وضعیت سیستم", "system:home"));
},

async _showAdmins(message, admin) {
	const admins = await this.s.admins.list();
	const en = this._tgLanguage() === "en";
	const lines = [
		`<b>👥 ${this._tg("admins")}</b>`, "",
		`${en ? "Owner" : "مالک"}: <code>${escapeHtml(this.s.config.ownerId || (en ? "Not configured" : "تنظیم نشده"))}</code>`, "",
		`${en ? "Admins" : "ادمین‌ها"}: <b>${admins.length}</b>`,
	];
	const keyboard = admins.map((row) => [{ text: `${Number(row.is_active) === 1 ? "🟢" : "⚪"} ${row.first_name || row.username || row.user_id}`, callback_data: `admins:view:${row.user_id}` }]);
	if (admin.role === "owner") keyboard.push([{ text: en ? "➕ Add admin" : "➕ افزودن ادمین", callback_data: "admins:add" }]);
	keyboard.push([{ text: `⬅️ ${this._tg("managementPanel")}`, callback_data: "menu:home" }]);
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), { inline_keyboard: keyboard });
},

async _showAdminDetail(message, admin, userId) {
	const row = await this.s.admins.get(userId);
	if (!row) return this._showAdmins(message, admin);
	const en = this._tgLanguage() === "en";
	const name = row.first_name || row.username || row.user_id;
	const keyboard = [];
	if (admin.role === "owner") {
		keyboard.push([{ text: Number(row.is_active) === 1 ? (en ? "⏸ Disable" : "⏸ غیرفعال") : (en ? "▶️ Enable" : "▶️ فعال"), callback_data: `admins:toggle:${row.user_id}` }]);
		keyboard.push([{ text: en ? "🗑 Delete admin" : "🗑 حذف ادمین", callback_data: `admins:delete:${row.user_id}` }]);
	}
	keyboard.push([{ text: `⬅️ ${this._tg("admins")}`, callback_data: "admins:home" }]);
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`<b>👤 ${escapeHtml(name)}</b>\n\nID: <code>${escapeHtml(row.user_id)}</code>\nStatus: <b>${Number(row.is_active) === 1 ? (en ? "Enabled" : "فعال") : (en ? "Disabled" : "غیرفعال")}</b>`,
		{ inline_keyboard: keyboard },
	);
},

async _handleAddAdminInput(message, admin) {
	if (admin.role !== "owner") return;
	const en = this._tgLanguage() === "en";
	const targetId = normalizeDigits(String(message.text || "").trim());
	if (!/^\d{5,20}$/.test(targetId)) return this.s.telegram.sendMessage(message.chat.id, en ? "🔴 Invalid numeric Telegram ID." : "🔴 آیدی عددی معتبر نیست.");
	if (targetId === this.s.config.ownerId) return this.s.telegram.sendMessage(message.chat.id, en ? "ℹ️ This ID belongs to the owner." : "ℹ️ این شناسه متعلق به مالک است.");
	await this.s.admins.add(targetId, message.from.id);
	await this.s.adminInput.clear(message.from.id);
	await this.s.audit.add(message.from.id, "admin.added", { targetId });
	return this.s.telegram.sendMessage(
		message.chat.id,
		en ? `✅ Admin <code>${escapeHtml(targetId)}</code> added.` : `✅ ادمین <code>${escapeHtml(targetId)}</code> اضافه شد.`,
		{ inline_keyboard: [[{ text: `👥 ${this._tg("admins")}`, callback_data: "admins:home" }]] },
	);
},

_disabledText(admin) {
	const en = this._tgLanguage() === "en";
	return `<b>⏸ ${escapeHtml(this.s.config.displayName)}</b>\n\n<blockquote>🔴 ${en ? "System is disabled" : "سیستم غیرفعال است"}</blockquote>\n\n${en ? "Role" : "نقش"}: <b>${this._tg(admin.role === "owner" ? "owner" : "admin")}</b>`;
}
};
