import { backKeyboard } from "../../telegram/ui.js";
import { escapeHtml } from "../../utils/core.js";
import { formatOptionalSystemDateTime } from "../../utils/datetime.js";

export const telegram_systemMethods = {
async _showSystem(message) {
	const snapshot = await this.s.systemManagement.snapshot();
	const en = this._tgLanguage() === "en";
	const health = snapshot.health || {};
	const runtime = snapshot.runtime || {};
	const database = snapshot.database || {};
	const cache = snapshot.cache || {};
	const automation = snapshot.automation || {};
	const sources = snapshot.sources || {};
	const admins = snapshot.admins || {};
	const runtimeSettings = snapshot.settings?.runtime || {};
	const secureSettings = snapshot.settings?.secure || {};

	const lines = [
		`<b>📊 ${en ? "System status" : "وضعیت سیستم"}</b>`,
		"",
		`<blockquote>${this._systemHealthIcon(health.status)} ${escapeHtml(this._systemHealthLabel(health.status, en))}</blockquote>`,
		"",
		`🤖 ${en ? "Bot" : "ربات"}: <b>${runtime.botEnabled ? (en ? "Enabled" : "فعال") : (en ? "Disabled" : "غیرفعال")}</b>`,
		`🧩 Runtime: <code>v${escapeHtml(runtime.version || "—")} · schema ${escapeHtml(runtime.schemaVersion ?? "—")}</code>`,
		`🌐 Timezone: <code>${escapeHtml(runtime.timezone || "—")}</code>`,
		`🛡 Integrity: <code>${runtime.integrity ? "OK" : "FAILED"}</code>`,
		"",
		`🗄 D1: <b>${database.connected ? (en ? "Connected" : "متصل") : (en ? "Unavailable" : "در دسترس نیست")}</b> · <code>${Number(database.latency_ms || 0)}ms</code>`,
		`🧊 ${en ? "Cache" : "کش"}: <b>${escapeHtml(this._systemCacheLabel(cache, en))}</b>`,
		`🕒 ${en ? "Automation" : "اتوماسیون"}: <b>${automation.enabled ? "ON" : "OFF"}</b> · <code>${escapeHtml(this._systemAutomationReason(automation.reason, en))}</code>`,
		`⏭ ${en ? "Next publish" : "انتشار بعدی"}: <code>${escapeHtml(formatOptionalSystemDateTime(this.s.config, automation.nextPublishAt))}</code>`,
		"",
		`📡 ${en ? "Sources" : "منابع"}: <b>${Number(sources.healthy || 0)}/${Number(sources.enabled || 0)}</b> ${en ? "healthy" : "سالم"} · ${Number(sources.failed || 0)} ${en ? "failed" : "ناموفق"} · ${Number(sources.unchecked || 0)} ${en ? "unchecked" : "بررسی‌نشده"}`,
		`👥 ${en ? "Admins" : "ادمین‌ها"}: <b>${Number(admins.activeAdmins || 0)}</b> ${en ? "active" : "فعال"} · ${Number(admins.inactiveAdmins || 0)} ${en ? "inactive" : "غیرفعال"}`,
		"",
		`⚙️ Runtime settings: <code>${Number(runtimeSettings.d1Count || 0)}/${Number(runtimeSettings.total || 0)} D1</code>`,
		`🔐 Secure settings: <code>${Number(secureSettings.encryptedCount || 0)}/${Number(secureSettings.managedCount || 0)} encrypted</code>`,
	];

	if (health.reasonCodes?.length) {
		lines.push("", `<b>⚠️ ${en ? "Health reasons" : "دلایل وضعیت"}</b>`);
		for (const reason of health.reasonCodes.slice(0, 6)) {
			lines.push(`• ${escapeHtml(this._systemReasonLabel(reason, en))} <code>${escapeHtml(reason)}</code>`);
		}
	}

	lines.push(
		"",
		`<blockquote>ℹ️ ${en ? "Telegram and Web Admin use the same system health snapshot. No providers are refreshed from this screen." : "تلگرام و Web Admin از یک snapshot مشترک سلامت سیستم استفاده می‌کنند. از این صفحه هیچ Providerای Refresh نمی‌شود."}</blockquote>`,
	);

	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		lines.join("\n").slice(0, 3900),
		{
			inline_keyboard: [
				[
					{ text: en ? "🔄 Refresh" : "🔄 بروزرسانی", callback_data: "system:home" },
					{ text: en ? "🗄 Database" : "🗄 دیتابیس", callback_data: "database:home" },
				],
				[{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" }],
			],
		},
	);
},

async _showDatabase(message) {
	const snapshot = await this.s.systemManagement.snapshot();
	const status = snapshot.database || {};
	const storage = status.storage || {};
	const en = this._tgLanguage() === "en";
	const lines = [
		`<b>🗄 ${en ? "Database status" : "وضعیت دیتابیس"}</b>`,
		"",
		`<blockquote>${status.connected ? (en ? "🟢 Cloudflare D1 connected" : "🟢 Cloudflare D1 متصل است") : (en ? "🔴 D1 connection failed" : "🔴 اتصال D1 ناموفق است")}</blockquote>`,
		"",
		`Provider: <code>${escapeHtml(status.provider || "—")}</code>`,
		`Latency: <code>${Number(status.latency_ms || 0)}ms</code>`,
		`Schema: <code>${escapeHtml(snapshot.runtime?.schemaVersion ?? status.schema_version ?? "—")}</code>`,
		"",
		`<b>💾 ${en ? "Database storage" : "فضای دیتابیس"}</b>`,
		"",
	];

	if (storage.available) {
		lines.push(
			`${escapeHtml(storage.bar || "")}  ${Number(storage.percent || 0).toFixed(2)}%`,
			"",
			`${en ? "Used" : "مصرف‌شده"}: ${Number(storage.used_mb || 0).toFixed(2)} MB`,
			`${en ? "Total" : "فضای کل"}: ${Number(storage.total_mb || 0).toFixed(2)} MB`,
			`${en ? "Remaining" : "باقی‌مانده"}: ${Number(storage.remaining_mb || 0).toFixed(2)} MB`,
			"",
		);
	} else {
		lines.push(`<code>${en ? "Storage metrics unavailable" : "اطلاعات فضای دیتابیس در دسترس نیست"}</code>`, "");
	}

	lines.push(
		`<b>📊 ${en ? "Records" : "رکوردها"}</b>`,
		...Object.entries(status.records || {}).map(
			([key, value]) => `${escapeHtml(key)}: <code>${Number(value || 0)}</code>`,
		),
		"",
		`<blockquote>ℹ️ ${en ? "This is the same D1 snapshot used by Web Admin system diagnostics." : "این همان snapshot دیتابیس مورد استفاده Web Admin است."}</blockquote>`,
	);

	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		lines.join("\n").slice(0, 3900),
		{
			inline_keyboard: [
				[{ text: en ? "🔄 Refresh database" : "🔄 بروزرسانی دیتابیس", callback_data: "database:home" }],
				[{ text: en ? "⬅️ System status" : "⬅️ وضعیت سیستم", callback_data: "system:home" }],
			],
		},
	);
},

_systemHealthIcon(status) {
	switch (status) {
		case "healthy": return "🟢";
		case "degraded": return "🟡";
		case "disabled": return "⚪";
		default: return "🔴";
	}
},

_systemHealthLabel(status, en) {
	const labels = {
		healthy: en ? "Healthy" : "سالم",
		degraded: en ? "Needs attention" : "نیازمند توجه",
		critical: en ? "Critical" : "بحرانی",
		disabled: en ? "Disabled" : "غیرفعال",
	};
	return labels[status] || (en ? "Unknown" : "نامشخص");
},

_systemCacheLabel(cache, en) {
	if (!cache?.present) return en ? "Empty" : "خالی";
	if (cache.expired) return en ? "Expired" : "منقضی";
	return en ? "Fresh" : "تازه";
},

_systemAutomationReason(reason, en) {
	const labels = {
		ready: en ? "Ready" : "آماده انتشار",
		waiting_for_next_slot: en ? "Waiting for next slot" : "در انتظار بازه بعدی",
		quiet_hours: en ? "Quiet hours" : "ساعت استراحت",
		already_published: en ? "Already published" : "قبلاً منتشر شده",
		retry_pending: en ? "Retry pending" : "تلاش مجدد در انتظار",
		automation_disabled: en ? "Automation disabled" : "اتوماسیون غیرفعال",
		bot_disabled: en ? "Bot disabled" : "ربات غیرفعال",
	};
	return labels[reason] || String(reason || (en ? "Unknown" : "نامشخص"));
},

_systemReasonLabel(reason, en) {
	const labels = {
		database_unavailable: en ? "Database unavailable" : "دیتابیس در دسترس نیست",
		runtime_integrity_failed: en ? "Runtime integrity failed" : "Runtime integrity ناموفق است",
		runtime_settings_invalid: en ? "Invalid D1 runtime settings" : "تنظیم Runtime نامعتبر در D1",
		no_sources_enabled: en ? "No sources enabled" : "هیچ منبعی فعال نیست",
		source_failures: en ? "Source failures detected" : "یک یا چند منبع ناموفق هستند",
		sources_unverified: en ? "Some sources are unchecked" : "برخی منابع بررسی نشده‌اند",
		cache_empty: en ? "Market cache is empty" : "کش بازار خالی است",
		cache_expired: en ? "Market cache expired" : "کش بازار منقضی شده",
		cache_last_error: en ? "Market cache has a last error" : "کش بازار آخرین خطا دارد",
		bot_disabled: en ? "Bot is disabled" : "ربات غیرفعال است",
		runtime_settings_legacy_fallback: en ? "Runtime settings use ENV fallback" : "برخی Runtime settingها از ENV خوانده می‌شوند",
		runtime_settings_default_fallback: en ? "Runtime settings use defaults" : "برخی Runtime settingها از مقدار پیش‌فرض استفاده می‌کنند",
	};
	return labels[reason] || String(reason || (en ? "Unknown reason" : "دلیل نامشخص"));
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
