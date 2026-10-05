import { APP } from "../../config/app.js";
import { runtimeIntegrity } from "../../app/runtime-integrity.js";
import { databaseStatus } from "../../system/database-status.js";
import { backKeyboard } from "../../telegram/ui.js";
import { escapeHtml, parseBoolean } from "../../utils/core.js";
import {
	formatOptionalSystemDateTime,
	formatSystemDate,
	formatSystemTime,
} from "../../utils/datetime.js";

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
	const actor = this._adminActor(admin);
	const snapshot = await this.s.adminManagement.snapshot(actor);
	const en = this._tgLanguage() === "en";
	const lines = [
		`<b>👥 ${this._tg("admins")}</b>`, "",
		`<blockquote>${en ? "Telegram admin access is synchronized with Web Admin." : "دسترسی ادمین‌های تلگرام با Web Admin همگام است."}</blockquote>`, "",
		`${en ? "Total access" : "کل دسترسی‌ها"}: <b>${snapshot.stats.total}</b>`,
		`${en ? "Active admins" : "ادمین فعال"}: <b>${snapshot.stats.activeAdmins}</b>`,
		`${en ? "Inactive admins" : "ادمین غیرفعال"}: <b>${snapshot.stats.inactiveAdmins}</b>`,
	];

	const keyboard = snapshot.admins.map((item) => [{
		text: `${item.role === "owner" ? "🔒" : item.active ? "🟢" : "⚪"} ${item.displayName}`,
		callback_data: `admins:view:${item.userId}`,
	}]);
	if (snapshot.capabilities.canManage) {
		keyboard.push([{ text: en ? "➕ Add admin" : "➕ افزودن ادمین", callback_data: "admins:add" }]);
	}
	keyboard.push([{ text: `⬅️ ${this._tg("managementPanel")}`, callback_data: "menu:home" }]);
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), { inline_keyboard: keyboard });
},

async _showAdminDetail(message, admin, userId) {
	const actor = this._adminActor(admin);
	const item = await this.s.adminManagement.get(userId, actor);
	if (!item) return this._showAdmins(message, admin);

	const en = this._tgLanguage() === "en";
	const role = item.role === "owner" ? (en ? "Owner" : "مالک") : (en ? "Admin" : "ادمین");
	const status = item.active ? (en ? "Enabled" : "فعال") : (en ? "Disabled" : "غیرفعال");
	const lastActivity = item.updatedAt
		? formatOptionalSystemDateTime(this.s.config, item.updatedAt)
		: (en ? "No activity recorded" : "فعالیتی ثبت نشده");
	const createdAt = item.createdAt
		? formatOptionalSystemDateTime(this.s.config, item.createdAt)
		: "—";

	const lines = [
		`<b>👤 ${escapeHtml(item.displayName)}</b>`, "",
		`${en ? "Role" : "نقش"}: <b>${role}</b>`,
		`ID: <code>${escapeHtml(item.userId)}</code>`,
		`${en ? "Status" : "وضعیت"}: <b>${status}</b>`,
		`${en ? "Username" : "نام کاربری"}: <code>${escapeHtml(item.username ? `@${item.username}` : "—")}</code>`, "",
		`${en ? "Last activity" : "آخرین فعالیت"}: <code>${escapeHtml(lastActivity)}</code>`,
		`${en ? "Created" : "ایجاد"}: <code>${escapeHtml(createdAt)}</code>`,
		`${en ? "Added by" : "افزوده‌شده توسط"}: <code>${escapeHtml(item.addedBy || "—")}</code>`,
	];
	if (item.immutable) {
		lines.push("", `<blockquote>🔒 ${en ? "Owner access is protected and cannot be disabled or removed." : "دسترسی مالک محافظت‌شده است و قابل غیرفعال‌سازی یا حذف نیست."}</blockquote>`);
	}

	const keyboard = [];
	if (admin.role === "owner" && !item.immutable) {
		keyboard.push([{
			text: item.active ? (en ? "⏸ Disable" : "⏸ غیرفعال") : (en ? "▶️ Enable" : "▶️ فعال"),
			callback_data: `admins:set:${item.userId}:${item.active ? "0" : "1"}`,
		}]);
		keyboard.push([{
			text: en ? "🗑 Remove admin" : "🗑 حذف ادمین",
			callback_data: `admins:delete:confirm:${item.userId}`,
		}]);
	}
	keyboard.push([{ text: `⬅️ ${this._tg("admins")}`, callback_data: "admins:home" }]);

	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{ inline_keyboard: keyboard },
	);
},

async _beginAddAdmin(message, admin, user) {
	const en = this._tgLanguage() === "en";
	if (admin.role !== "owner") {
		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			`<b>👥 ${this._tg("admins")}</b>\n\n<blockquote>🔒 ${en ? "Only the owner can modify administrators." : "فقط مالک می‌تواند ادمین‌ها را تغییر دهد."}</blockquote>`,
			backKeyboard(this._tg("admins"), "admins:home"),
		);
	}
	await this.s.adminInput.set(user.id, "add_admin");
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		en
			? "<b>➕ Add admin</b>\n\nSend the user's numeric Telegram ID.\n\n<blockquote>ℹ️ The owner is immutable. Existing admins are re-enabled idempotently.</blockquote>"
			: "<b>➕ افزودن ادمین</b>\n\nآیدی عددی Telegram کاربر را ارسال کنید.\n\n<blockquote>ℹ️ مالک قابل تغییر نیست و ادمین موجود به‌صورت امن دوباره فعال می‌شود.</blockquote>",
		backKeyboard(this._tg("admins"), "admins:home"),
	);
},

async _setAdminEnabled(message, admin, targetId, enabled) {
	const actor = this._adminActor(admin);
	try {
		await this.s.adminManagement.setEnabled(targetId, Boolean(enabled), actor);
		return this._showAdminDetail(message, admin, targetId);
	} catch (error) {
		return this._showAdminManagementError(message, error);
	}
},

async _confirmAdminDelete(message, admin, targetId) {
	const actor = this._adminActor(admin);
	const en = this._tgLanguage() === "en";
	try {
		const item = await this.s.adminManagement.get(targetId, actor);
		if (!item) return this._showAdmins(message, admin);
		if (admin.role !== "owner" || item.immutable) {
			return this._showAdminManagementError(message, { code: item.immutable ? "owner_immutable" : "owner_required" });
		}
		const text = en
			? `<b>🗑 Remove admin</b>\n\n<blockquote>⚠️ Remove <b>${escapeHtml(item.displayName)}</b> (<code>${escapeHtml(item.userId)}</code>) from Telegram access?</blockquote>\n\nThis is a real access change.`
			: `<b>🗑 حذف ادمین</b>\n\n<blockquote>⚠️ دسترسی <b>${escapeHtml(item.displayName)}</b> (<code>${escapeHtml(item.userId)}</code>) حذف شود؟</blockquote>\n\nاین عملیات واقعاً دسترسی تلگرام را حذف می‌کند.`;
		return this.s.telegram.editMessage(message.chat.id, message.message_id, text, {
			inline_keyboard: [
				[{ text: en ? "✅ Confirm removal" : "✅ تأیید حذف", callback_data: `admins:delete:execute:${item.userId}` }],
				[{ text: en ? "❌ Cancel" : "❌ لغو", callback_data: `admins:view:${item.userId}` }],
			],
		});
	} catch (error) {
		return this._showAdminManagementError(message, error);
	}
},

async _executeAdminDelete(message, admin, targetId) {
	const actor = this._adminActor(admin);
	try {
		await this.s.adminManagement.remove(targetId, actor);
		return this._showAdmins(message, admin);
	} catch (error) {
		return this._showAdminManagementError(message, error);
	}
},

async _handleAddAdminInput(message, admin) {
	const en = this._tgLanguage() === "en";
	const actor = this._adminActor(admin, message.from?.id);
	try {
		const added = await this.s.adminManagement.add(message.text, actor);
		await this.s.adminInput.clear(message.from.id);
		return this.s.telegram.sendMessage(
			message.chat.id,
			en
				? `✅ Admin <code>${escapeHtml(added.userId)}</code> added or re-enabled.`
				: `✅ ادمین <code>${escapeHtml(added.userId)}</code> اضافه یا دوباره فعال شد.`,
			{ inline_keyboard: [[{ text: `👥 ${this._tg("admins")}`, callback_data: "admins:home" }]] },
		);
	} catch (error) {
		return this.s.telegram.sendMessage(
			message.chat.id,
			`🔴 ${escapeHtml(this._adminManagementErrorText(error, en))}`,
			{ inline_keyboard: [[{ text: `👥 ${this._tg("admins")}`, callback_data: "admins:home" }]] },
		);
	}
},

_adminActor(admin, fallbackUserId = null) {
	return {
		type: "telegram",
		role: admin?.role || "admin",
		id: admin?.userId || fallbackUserId || admin?.user?.id || null,
	};
},

_showAdminManagementError(message, error) {
	const en = this._tgLanguage() === "en";
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`<b>👥 ${this._tg("admins")}</b>\n\n<blockquote>🔴 ${escapeHtml(this._adminManagementErrorText(error, en))}</blockquote>`,
		backKeyboard(this._tg("admins"), "admins:home"),
	);
},

_adminManagementErrorText(error, en) {
	switch (error?.code) {
		case "invalid_telegram_id":
			return en ? "Invalid numeric Telegram ID." : "آیدی عددی Telegram معتبر نیست.";
		case "owner_immutable":
			return en ? "Owner access is immutable." : "دسترسی مالک قابل تغییر نیست.";
		case "owner_required":
			return en ? "Only the owner can modify administrators." : "فقط مالک می‌تواند ادمین‌ها را تغییر دهد.";
		case "admin_not_found":
			return en ? "Administrator not found." : "ادمین پیدا نشد.";
		default:
			return en ? "Admin operation failed." : "عملیات مدیریت ادمین ناموفق بود.";
	}
},

_disabledText(admin) {
	const en = this._tgLanguage() === "en";
	return `<b>⏸ ${escapeHtml(this.s.config.displayName)}</b>\n\n<blockquote>🔴 ${en ? "System is disabled" : "سیستم غیرفعال است"}</blockquote>\n\n${en ? "Role" : "نقش"}: <b>${this._tg(admin.role === "owner" ? "owner" : "admin")}</b>`;
}
};
