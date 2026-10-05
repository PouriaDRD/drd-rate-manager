import { APP } from "../../config/app.js";
import { runtimeIntegrity } from "../../app/runtime-integrity.js";
import { jsonResponse } from "../../http/responses.js";
import { databaseStatus } from "../../system/database-status.js";
import {
	backKeyboard,
	normalizeCommand,
	resolveUsdtFromStatuses,
	sourceStatusText,
} from "../../telegram/ui.js";
import { calculateNextPublishAt } from "../../utils/automation.js";
import {
	chunk,
	coinNameFa,
	errorMessage,
	escapeHtml,
	normalizeDigits,
	pad2,
	parseBoolean,
} from "../../utils/core.js";
import {
	formatIranDate,
	formatIranTime,
	formatOptionalSystemDateTime,
	formatSystemDate,
	formatSystemTime,
} from "../../utils/datetime.js";
import {
	changeIcon,
	formatFaChangeValue,
	formatFaInteger,
	formatOptionalToman,
	formatOptionalUsd,
	roundToNearest,
} from "../../utils/formatters.js";

export const telegram_systemMethods = {
async _showSystem(message) {
	const [enabled, ttl, automation] = await Promise.all([
		this.s.settings.get("bot_enabled", "1"),
		this.s.market.cacheTtlSeconds(),
		this.s.automation.getSettings(),
	]);
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		[
			"<b>📊 وضعیت سیستم</b>",
			"",
			`<blockquote>${parseBoolean(enabled, true) ? "🟢 Worker فعال است" : "🔴 Worker غیرفعال است"}</blockquote>`,
			"",
			`Version: <code>${escapeHtml(this.s.config.version)}</code>`,
			`Schema: <code>${APP.schemaVersion}</code>`,
			`Timezone: <code>${escapeHtml(this.s.config.timezone)}</code>`,
			`Cache: <code>${ttl}s</code>`,
			`Automation: <code>${automation.enabled ? "ON" : "OFF"}</code>`,
			`Integrity: <code>${runtimeIntegrity() ? "OK" : "FAILED"}</code>`,
			"",
			`📅 ${formatSystemDate(this.s.config, Date.now())} · 🕒 ${formatSystemTime(this.s.config, Date.now())}`,
		].join("\n"),
		{
			inline_keyboard: [
				[{ text: "🗄 وضعیت دیتابیس", callback_data: "database:home" }],
				[{ text: "⬅️ تنظیمات", callback_data: "settings:home" }],
			],
		},
	);
},

async _showDatabase(message) {
	const status = await databaseStatus(this.s);
	const storage = status.storage;
	const lines = [
		"<b>🗄 وضعیت دیتابیس</b>",
		"",
		`<blockquote>${status.connected ? "🟢 Cloudflare D1 متصل است" : "🔴 اتصال D1 ناموفق است"}</blockquote>`,
		"",
		`Provider: <code>${escapeHtml(status.provider)}</code>`,
		`Latency: <code>${status.latency_ms}ms</code>`,
		"",
		"<b>💾 فضای دیتابیس</b>",
		"",
	];
	if (storage.available) {
		lines.push(
			`${storage.bar}  ${storage.percent.toFixed(2)}%`,
			"",
			`استفاده: ${storage.percent.toFixed(2)}%`,
			`مصرف‌شده: ${storage.used_mb.toFixed(2)} MB`,
			`فضای کل: ${storage.total_mb.toFixed(2)} MB`,
			`باقی‌مانده: ${storage.remaining_mb.toFixed(2)} MB`,
			"",
		);
	}
	lines.push(
		"<b>📊 رکوردها</b>",
		...Object.entries(status.records).map(
			([key, value]) => `${escapeHtml(key)}: <code>${value}</code>`,
		),
		"",
		`Schema: <code>${APP.schemaVersion}</code>`,
	);
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		backKeyboard("وضعیت سیستم", "system:home"),
	);
},

async _showAdmins(message, admin) {
	const admins = await this.s.admins.list();
	const lines = [
		"<b>👥 مدیریت ادمین‌ها</b>",
		"",
		`مالک: <code>${escapeHtml(this.s.config.ownerId || "تنظیم نشده")}</code>`,
		"",
		`ادمین‌ها: <b>${admins.length}</b>`,
	];
	const keyboard = admins.map((row) => [{
		text: `${Number(row.is_active) === 1 ? "🟢" : "⚪"} ${row.first_name || row.username || row.user_id}`,
		callback_data: `admins:view:${row.user_id}`,
	}]);
	if (admin.role === "owner") {
		keyboard.push([{ text: "➕ افزودن ادمین", callback_data: "admins:add" }]);
	}
	keyboard.push([{ text: "⬅️ پنل مدیریت", callback_data: "menu:home" }]);
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), {
		inline_keyboard: keyboard,
	});
},

async _showAdminDetail(message, admin, userId) {
	const row = await this.s.admins.get(userId);
	if (!row) return this._showAdmins(message, admin);
	const name = row.first_name || row.username || row.user_id;
	const keyboard = [];
	if (admin.role === "owner") {
		keyboard.push([{
			text: Number(row.is_active) === 1 ? "⏸ غیرفعال" : "▶️ فعال",
			callback_data: `admins:toggle:${row.user_id}`,
		}]);
		keyboard.push([{
			text: "🗑 حذف ادمین",
			callback_data: `admins:delete:${row.user_id}`,
		}]);
	}
	keyboard.push([{ text: "⬅️ مدیریت ادمین‌ها", callback_data: "admins:home" }]);
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`<b>👤 ${escapeHtml(name)}</b>\n\nID: <code>${escapeHtml(row.user_id)}</code>\nStatus: <b>${Number(row.is_active) === 1 ? "فعال" : "غیرفعال"}</b>`,
		{ inline_keyboard: keyboard },
	);
},

async _handleAddAdminInput(message, admin) {
	if (admin.role !== "owner") return;
	const targetId = normalizeDigits(String(message.text || "").trim());
	if (!/^\d{5,20}$/.test(targetId)) {
		return this.s.telegram.sendMessage(message.chat.id, "🔴 آیدی عددی معتبر نیست.");
	}
	if (targetId === this.s.config.ownerId) {
		return this.s.telegram.sendMessage(message.chat.id, "ℹ️ این شناسه متعلق به مالک است.");
	}
	await this.s.admins.add(targetId, message.from.id);
	await this.s.adminInput.clear(message.from.id);
	await this.s.audit.add(message.from.id, "admin.added", { targetId });
	return this.s.telegram.sendMessage(
		message.chat.id,
		`✅ ادمین <code>${escapeHtml(targetId)}</code> اضافه شد.`,
		{ inline_keyboard: [[{ text: "👥 مدیریت ادمین‌ها", callback_data: "admins:home" }]] },
	);
},

_disabledText(admin) {
	return `<b>⏸ ${escapeHtml(this.s.config.displayName)}</b>\n\n<blockquote>🔴 سیستم غیرفعال است</blockquote>\n\nنقش: <b>${admin.role === "owner" ? "مالک" : "ادمین"}</b>`;
}
};
