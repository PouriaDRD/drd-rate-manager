import { APP } from "../../config/app.js";
import { backKeyboard, resolveUsdtFromStatuses, sourceStatusText } from "../../telegram/ui.js";
import { chunk, escapeHtml, pad2, parseBoolean } from "../../utils/core.js";
import { formatOptionalSystemDateTime } from "../../utils/datetime.js";
import { formatFaInteger } from "../../utils/formatters.js";

export const telegram_settingsMethods = {
async _showSources(message, force = false) {
	if (force) await this.s.market.forceRefreshSources();
	const snapshot = await this.s.sourceSettings.snapshot();
	const en = this._tgLanguage() === "en";
	const roleFor = (name) => {
		const index = snapshot.usdt_priority.indexOf(name);
		return index === 0 ? "Primary" : index > 0 ? `Fallback #${index}` : null;
	};
	const lines = [
		`<b>📡 ${en ? "Source management" : "مدیریت منابع"}</b>`, "",
		`<b>💵 ${en ? "USDT / Toman" : "تتر / تومان"}</b>`, "",
	];
	for (const name of snapshot.usdt_priority) {
		const source = snapshot.sources[name];
		lines.push(
			`${source.enabled ? "🟢" : "⚪"} <b>${escapeHtml(source.label)}</b> · <code>${roleFor(name)}</code>`,
			source.enabled ? sourceStatusText(source.label, source.status, null) : `<code>${en ? "Disabled" : "غیرفعال"}</code>`,
			"",
		);
	}
	for (const name of ["coingecko", "wallgold"]) {
		const source = snapshot.sources[name];
		lines.push(
			`${source.enabled ? "🟢" : "⚪"} <b>${escapeHtml(source.label)}</b>`,
			source.enabled ? sourceStatusText(source.label, source.status, null) : `<code>${en ? "Disabled" : "غیرفعال"}</code>`,
			"",
		);
	}
	const toggles = Object.values(snapshot.sources).map((source) => ({
		text: `${source.enabled ? "✅" : "▫️"} ${source.label}`,
		callback_data: `sources:toggle:${source.name}`,
	}));
	const keyboard = chunk(toggles, 2);
	keyboard.push([{ text: "🪙 CoinGecko", callback_data: "coingecko:home" }]);
	keyboard.push([{ text: en ? "💵 USDT route" : "💵 مسیر دریافت تتر", callback_data: "sources:usdt" }]);
	keyboard.push([{ text: en ? "🔄 Refresh" : "🔄 بررسی مجدد", callback_data: "sources:refresh" }]);
	keyboard.push([{ text: `⬅️ ${this._tg("managementPanel")}`, callback_data: "menu:home" }]);
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), { inline_keyboard: keyboard });
},
async _showUsdt(message) {
	const snapshot = await this.s.sourceSettings.snapshot();
	const en = this._tgLanguage() === "en";
	const labels = snapshot.usdt_priority.map((name) => snapshot.sources[name]?.label || name);
	let selected = null;
	for (const name of snapshot.usdt_priority) {
		const source = snapshot.sources[name];
		if (source?.enabled && source.status?.success && source.status?.price != null) {
			selected = source;
			break;
		}
	}
	const text = selected
		? `<b>💵 ${en ? "USDT route" : "مسیر دریافت تتر"}</b>\n\n<blockquote>✅ ${en ? "Valid cached price" : "قیمت معتبر کش‌شده"}</blockquote>\n\n💰 <b>${formatFaInteger(selected.status.price)} ${en ? "Toman" : "تومان"}</b>\n\n📡 <b>${escapeHtml(selected.label)}</b>\n\n${labels.join(" → ")}`
		: `<b>💵 ${en ? "USDT route" : "مسیر دریافت تتر"}</b>\n\n<blockquote>🟡 ${en ? "No cached USDT price from enabled sources" : "قیمت تتر از منابع فعال در کش موجود نیست"}</blockquote>\n\n${labels.join(" → ")}`;
	return this.s.telegram.editMessage(message.chat.id, message.message_id, text, {
		inline_keyboard: [
			[{ text: en ? "↻ Rotate priority" : "↻ چرخش اولویت", callback_data: "sources:priority:rotate" }],
			[{ text: en ? "🔄 Refresh sources" : "🔄 بروزرسانی منابع", callback_data: "sources:refresh" }],
			[{ text: `⬅️ ${this._tg("sources")}`, callback_data: "sources:home" }],
		],
	});
},
async _showCoinGecko(message, force = false) {
	let refreshError = null;
	if (force) {
		const result = await this.s.coinGecko.fetchTopAssets();
		if (result.success) await this.s.assets.syncTopAssets(result.assets);
		else refreshError = result.message;
	}
	const assets = await this.s.assets.all();
	const en = this._tgLanguage() === "en";
	const lines = [
		"<b>🪙 CoinGecko</b>", "",
		`<blockquote>${refreshError ? `🔴 ${escapeHtml(refreshError)}` : `🟢 ${assets.length} ${en ? "cached assets" : "دارایی کش‌شده"}`}</blockquote>`,
		"", en ? "Toggle assets to include or exclude them from market posts." : "با انتخاب هر مورد، نمایش آن در پست‌های بازار فعال/غیرفعال می‌شود.",
	];
	const keyboard = assets.slice(0, this.s.config.coinGeckoTopLimit).map((asset) => [{
		text: `${asset.enabled ? "✅" : "▫️"} ${asset.symbol} · ${asset.name_fa}`,
		callback_data: `coingecko:toggle:${asset.id}`,
	}]);
	keyboard.push([{ text: en ? "🔄 Refresh list" : "🔄 بروزرسانی لیست", callback_data: "coingecko:refresh" }]);
	keyboard.push([{ text: `⬅️ ${this._tg("sources")}`, callback_data: "sources:home" }]);
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), { inline_keyboard: keyboard });
},

async _showSettings(message, admin) {
	const ttl = await this.s.market.cacheTtlSeconds();
	const enabled = parseBoolean(await this.s.settings.get("bot_enabled", "1"), true);
	const en = this._tgLanguage() === "en";
	const keyboard = [
		[{ text: en ? "🕒 Publishing schedule" : "🕒 زمان‌بندی انتشار", callback_data: "automation:home" }],
		[{ text: en ? "📊 System status" : "📊 وضعیت سیستم", callback_data: "system:home" }],
		[{ text: `🗃 ${en ? "Market cache" : "کش بازار"} · ${ttl}s`, callback_data: "cache:home" }],
		[{ text: `🌐 ${this._tg("language")} · ${this._tg("languageName")}`, callback_data: "settings:language:toggle" }],
	];
	if (admin.role === "owner") {
		keyboard.push([{ text: enabled ? (en ? "⏸ Disable bot" : "⏸ غیرفعال کردن ربات") : (en ? "▶️ Enable bot" : "▶️ فعال کردن ربات"), callback_data: enabled ? "global:disable" : "global:enable" }]);
	}
	keyboard.push([{ text: `⬅️ ${this._tg("managementPanel")}`, callback_data: "menu:home" }]);
	const status = enabled ? (en ? "🟢 System is enabled" : "🟢 سیستم فعال است") : (en ? "🔴 System is disabled" : "🔴 سیستم غیرفعال است");
	const note = en
		? `Publishing, system health, cache lifetime and Telegram language are managed here. Current cache: ${ttl}s.`
		: `زمان‌بندی انتشار، وضعیت سیستم، مدت اعتبار کش و زبان تلگرام از این بخش مدیریت می‌شوند. کش فعلی: ${ttl} ثانیه.`;
	return this.s.telegram.editMessage(message.chat.id, message.message_id, `<b>⚙️ ${this._tg("settings")}</b>\n\n<blockquote>${status}</blockquote>\n\n<blockquote>ℹ️ ${note}</blockquote>`, { inline_keyboard: keyboard });
},

async _showCacheSettings(message) {
	const current = await this.s.market.cacheTtlSeconds();
	const en = this._tgLanguage() === "en";
	const keyboard = chunk(APP.cacheTtlOptions.map((seconds) => ({
		text: `${seconds === current ? "✅" : "▫️"} ${seconds}s`, callback_data: `cache:set:${seconds}`,
	})), 2);
	keyboard.push([{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" }]);
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`<b>🗃 ${en ? "Market cache" : "کش بازار"}</b>\n\n${en ? "Current TTL" : "مدت اعتبار فعلی"}: <b>${current}s</b>`,
		{ inline_keyboard: keyboard },
	);
},

async _showAutomation(message) {
	const state = await this.s.automationManagement.state();
	const automation = state.settings;
	const diagnostics = state.diagnostics;
	const en = this._tgLanguage() === "en";
	const reason = this._automationReasonText(diagnostics.reason, en);
	const lines = en ? [
		"<b>🕒 Publishing automation</b>", "",
		`<blockquote>${automation.enabled ? "🟢 Automatic publishing enabled" : "⚪ Automatic publishing disabled"}</blockquote>`, "",
		`🧭 Status: <b>${escapeHtml(reason)}</b>`,
		`⏱ Interval: <b>${automation.intervalMinutes} min</b>`,
		`🌙 Quiet hours: <b>${automation.quietHours.enabled ? `${automation.quietHours.start} – ${automation.quietHours.end}` : "Disabled"}</b>`, "",
		`📤 Last publish: <b>${formatOptionalSystemDateTime(this.s.config, automation.lastSuccessAt)}</b>`,
		`⏭ Next publish: <b>${formatOptionalSystemDateTime(this.s.config, diagnostics.nextPublishAt)}</b>`,
		`🔁 Retry: <b>${diagnostics.retryPending ? "Pending" : "None"}</b>`,
	] : [
		"<b>🕒 اتوماسیون انتشار</b>", "",
		`<blockquote>${automation.enabled ? "🟢 انتشار خودکار فعال است" : "⚪ انتشار خودکار غیرفعال است"}</blockquote>`, "",
		`🧭 وضعیت: <b>${escapeHtml(reason)}</b>`,
		`⏱ بازه انتشار: <b>${automation.intervalMinutes} دقیقه</b>`,
		`🌙 ساعت استراحت: <b>${automation.quietHours.enabled ? `${automation.quietHours.start} تا ${automation.quietHours.end}` : "غیرفعال"}</b>`, "",
		`📤 آخرین انتشار: <b>${formatOptionalSystemDateTime(this.s.config, automation.lastSuccessAt)}</b>`,
		`⏭ انتشار بعدی: <b>${formatOptionalSystemDateTime(this.s.config, diagnostics.nextPublishAt)}</b>`,
		`🔁 تلاش مجدد: <b>${diagnostics.retryPending ? "در انتظار" : "ندارد"}</b>`,
	];
	if (automation.lastError) {
		lines.push("", `🔴 ${en ? "Last error" : "آخرین خطا"}: <code>${escapeHtml(automation.lastError.slice(0, 350))}</code>`);
	}
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), {
		inline_keyboard: [
			[{ text: automation.enabled ? (en ? "⏸ Stop automation" : "⏸ توقف انتشار خودکار") : (en ? "▶️ Enable automation" : "▶️ فعال‌سازی انتشار خودکار"), callback_data: "automation:toggle" }],
			[
				{ text: automation.quietHours.enabled ? (en ? "🌙 Disable quiet hours" : "🌙 خاموش کردن استراحت") : (en ? "🌙 Enable quiet hours" : "🌙 فعال کردن استراحت"), callback_data: "automation:quiet:toggle" },
				{ text: en ? "⏱ Interval" : "⏱ بازه انتشار", callback_data: "automation:interval" },
			],
			[{ text: en ? "🕰 Edit quiet hours" : "🕰 تنظیم ساعت استراحت", callback_data: "automation:quiet:edit" }],
			[
				{ text: en ? "🧪 Dry run" : "🧪 اجرای آزمایشی", callback_data: "automation:dry-run" },
				{ text: en ? "🚀 Force run" : "🚀 انتشار اجباری", callback_data: "automation:force:confirm" },
			],
			[
				{ text: en ? "📚 History" : "📚 تاریخچه", callback_data: "automation:history" },
				{ text: en ? "🔄 Refresh" : "🔄 بروزرسانی", callback_data: "automation:refresh" },
			],
			[{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" }],
		],
	});
},

async _showAutomationHistory(message) {
	const history = await this.s.automationManagement.history(10);
	const en = this._tgLanguage() === "en";
	const lines = [`<b>📚 ${en ? "Automation history" : "تاریخچه اتوماسیون"}</b>`, ""];
	if (!history.length) {
		lines.push(`<blockquote>${en ? "No executions recorded yet." : "هنوز اجرایی ثبت نشده است."}</blockquote>`);
	} else {
		for (const run of history) {
			const icon = run.status === "success" ? "✅" : run.status === "preview" ? "🧪" : "🔴";
			const mode = this._automationModeText(run.mode, en);
			const when = formatOptionalSystemDateTime(this.s.config, run.finishedAt);
			const actor = run.actorType === "telegram"
				? `Telegram${run.actorId ? ` · ${escapeHtml(run.actorId)}` : ""}`
				: escapeHtml(run.actorType || "system");
			lines.push(`${icon} <b>${escapeHtml(mode)}</b> · ${when}`, `<code>${actor}</code>`, "");
		}
	}
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n").slice(0, 3900), {
		inline_keyboard: [
			[{ text: en ? "🔄 Refresh" : "🔄 بروزرسانی", callback_data: "automation:history" }],
			[{ text: en ? "⬅️ Automation" : "⬅️ اتوماسیون", callback_data: "automation:home" }],
		],
	});
},

async _showAutomationDryRun(message, user) {
	const en = this._tgLanguage() === "en";
	const result = await this.s.automationManagement.dryRun({
		actor: { type: "telegram", id: user?.id },
		refreshMarket: false,
	});
	const preview = String(result.fallbackHtml || result.rich?.html || "—").slice(0, 3000);
	const text = [
		`<b>🧪 ${en ? "Automation dry run" : "اجرای آزمایشی اتوماسیون"}</b>`,
		"",
		`<blockquote>✅ ${en ? "Nothing was published." : "هیچ پیامی منتشر نشد."}</blockquote>`,
		"",
		`<pre>${escapeHtml(preview)}</pre>`,
	].join("\n");
	return this.s.telegram.editMessage(message.chat.id, message.message_id, text, {
		inline_keyboard: [[{ text: en ? "⬅️ Automation" : "⬅️ اتوماسیون", callback_data: "automation:home" }]],
	});
},

async _confirmAutomationForceRun(message) {
	const en = this._tgLanguage() === "en";
	const text = en
		? "<b>🚀 Force publish</b>\n\n<blockquote>⚠️ This bypasses the scheduler, interval and quiet hours and publishes immediately.</blockquote>\n\nConfirm only if you want a real channel post now."
		: "<b>🚀 انتشار اجباری</b>\n\n<blockquote>⚠️ این عملیات زمان‌بندی، بازه انتشار و ساعت استراحت را نادیده می‌گیرد و همین حالا یک پست واقعی منتشر می‌کند.</blockquote>\n\nفقط اگر مطمئن هستید تأیید کنید.";
	return this.s.telegram.editMessage(message.chat.id, message.message_id, text, {
		inline_keyboard: [
			[{ text: en ? "✅ Confirm publish" : "✅ تأیید انتشار", callback_data: "automation:force:execute" }],
			[{ text: en ? "❌ Cancel" : "❌ لغو", callback_data: "automation:home" }],
		],
	});
},

async _executeAutomationForceRun(message, user) {
	const en = this._tgLanguage() === "en";
	const result = await this.s.automationManagement.forceRun({
		actor: { type: "telegram", id: user?.id },
		refreshMarket: false,
	});
	const text = en
		? `<b>✅ Force publish completed</b>\n\nMessage ID: <code>${escapeHtml(result.messageId ?? "—")}</code>\nPartial data: <b>${result.partial ? "Yes" : "No"}</b>`
		: `<b>✅ انتشار اجباری انجام شد</b>\n\nشناسه پیام: <code>${escapeHtml(result.messageId ?? "—")}</code>\nداده ناقص: <b>${result.partial ? "بله" : "خیر"}</b>`;
	return this.s.telegram.editMessage(message.chat.id, message.message_id, text, {
		inline_keyboard: [
			[{ text: en ? "📚 History" : "📚 تاریخچه", callback_data: "automation:history" }],
			[{ text: en ? "⬅️ Automation" : "⬅️ اتوماسیون", callback_data: "automation:home" }],
		],
	});
},

_automationReasonText(reason, en) {
	const labels = {
		ready: en ? "Ready" : "آماده انتشار",
		waiting_for_next_slot: en ? "Waiting for next slot" : "در انتظار بازه بعدی",
		interval_not_due: en ? "Interval not due" : "هنوز زمان انتشار نرسیده",
		quiet_hours: en ? "Quiet hours" : "ساعت استراحت",
		already_published: en ? "Already published in this slot" : "این بازه قبلاً منتشر شده",
		retry_pending: en ? "Retry pending" : "تلاش مجدد در انتظار",
		automation_disabled: en ? "Automation disabled" : "اتوماسیون غیرفعال",
		bot_disabled: en ? "Bot disabled" : "ربات غیرفعال",
		already_claimed: en ? "Another run owns this slot" : "این بازه توسط اجرای دیگری گرفته شده",
		success: en ? "Last run succeeded" : "آخرین اجرا موفق بود",
		error: en ? "Last run failed" : "آخرین اجرا ناموفق بود",
	};
	return labels[reason] || String(reason || (en ? "Unknown" : "نامشخص"));
},

_automationModeText(mode, en) {
	const labels = {
		scheduled: en ? "Scheduled" : "زمان‌بندی‌شده",
		manual: en ? "Manual force run" : "انتشار دستی",
		dry_run: en ? "Dry run" : "اجرای آزمایشی",
	};
	return labels[mode] || String(mode || "—");
},

async _showIntervals(message) {
	const automation = await this.s.automation.getSettings();
	const en = this._tgLanguage() === "en";
	const buttons = APP.publishIntervals.map((minutes) => ({
		text: `${minutes === automation.intervalMinutes ? "✅" : "▫️"} ${minutes} ${en ? "min" : "دقیقه"}`,
		callback_data: `automation:interval:set:${minutes}`,
	}));
	const keyboard = chunk(buttons, 3);
	keyboard.push([{ text: en ? "⬅️ Publishing schedule" : "⬅️ زمان‌بندی انتشار", callback_data: "automation:home" }]);
	return this.s.telegram.editMessage(message.chat.id, message.message_id, en ? "<b>⏱ Publish interval</b>\n\nSelect an interval." : "<b>⏱ بازه انتشار</b>\n\nبازه موردنظر را انتخاب کنید.", { inline_keyboard: keyboard });
},

_quietStartHour(message) {
	return this._hourPicker(message, this._tgLanguage() === "en" ? "<b>🌙 Quiet hours start</b>" : "<b>🌙 ساعت شروع استراحت</b>", (hour) => `quiet:start_hour:${hour}`, "automation:home");
},

_quietStartMinute(message, hour) {
	return this._minutePicker(message, this._tgLanguage() === "en" ? "<b>🌙 Start minute</b>" : "<b>🌙 دقیقه شروع</b>", (minute) => `quiet:start_minute:${hour}:${minute}`, "automation:home");
},

_quietEndHour(message, startHour, startMinute) {
	return this._hourPicker(message, this._tgLanguage() === "en" ? "<b>🌙 Quiet hours end</b>" : "<b>🌙 ساعت پایان استراحت</b>", (hour) => `quiet:end_hour:${startHour}:${startMinute}:${hour}`, "automation:home");
},

_quietEndMinute(message, startHour, startMinute, endHour) {
	return this._minutePicker(message, this._tgLanguage() === "en" ? "<b>🌙 End minute</b>" : "<b>🌙 دقیقه پایان استراحت</b>", (minute) => `quiet:end_minute:${startHour}:${startMinute}:${endHour}:${minute}`, "automation:home");
},

_hourPicker(message, title, callback, back) {
	const buttons = Array.from({ length: 24 }, (_, hour) => ({ text: pad2(hour), callback_data: callback(hour) }));
	const keyboard = chunk(buttons, 4);
	keyboard.push([{ text: this._tgLanguage() === "en" ? "⬅️ Back" : "⬅️ بازگشت", callback_data: back }]);
	return this.s.telegram.editMessage(message.chat.id, message.message_id, `${title}\n\n${this._tgLanguage() === "en" ? "Select hour." : "ساعت را انتخاب کنید."}`, { inline_keyboard: keyboard });
},

_minutePicker(message, title, callback, back) {
	const keyboard = [
		APP.quietMinuteOptions.map((minute) => ({ text: pad2(minute), callback_data: callback(minute) })),
		[{ text: this._tgLanguage() === "en" ? "⬅️ Back" : "⬅️ بازگشت", callback_data: back }],
	];
	return this.s.telegram.editMessage(message.chat.id, message.message_id, `${title}\n\n${this._tgLanguage() === "en" ? "Select minute." : "دقیقه را انتخاب کنید."}`, { inline_keyboard: keyboard });
}
};
