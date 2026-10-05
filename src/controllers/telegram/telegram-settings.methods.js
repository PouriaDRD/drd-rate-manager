import { APP } from "../../config/app.js";
import { backKeyboard, resolveUsdtFromStatuses, sourceStatusText } from "../../telegram/ui.js";
import { calculateNextPublishAt } from "../../utils/automation.js";
import { chunk, escapeHtml, pad2, parseBoolean } from "../../utils/core.js";
import { formatOptionalSystemDateTime } from "../../utils/datetime.js";
import { formatFaInteger } from "../../utils/formatters.js";

export const telegram_settingsMethods = {
async _showSources(message, force = false) {
	if (force) await this.s.market.forceRefreshSources();
	const sources = await this.s.statuses.all();
	const en = this._tgLanguage() === "en";
	const lines = [
		`<b>📡 ${en ? "Source management" : "مدیریت منابع"}</b>`, "",
		`<b>💵 ${en ? "USDT / Toman" : "تتر / تومان"}</b>`, "",
		sourceStatusText("Wallex", sources.wallex, "Primary"), "",
		sourceStatusText("Tabdeal", sources.tabdeal, "Fallback #1"), "",
		sourceStatusText("Exir", sources.exir, "Fallback #2"), "",
		`<b>🪙 ${en ? "Crypto & global metals" : "رمزارزها و فلزات جهانی"}</b>`, "",
		sourceStatusText("CoinGecko", sources.coingecko), "",
		`<b>🥇 ${en ? "Iran gold" : "طلای ایران"}</b>`, "",
		sourceStatusText("WallGold", sources.wallgold), "",
		`<blockquote>ℹ️ ${en ? "This page reads cached D1 status. Refresh performs live provider checks." : "این صفحه فقط از وضعیت کش‌شده D1 می‌خواند. «بررسی مجدد» منابع را بروزرسانی می‌کند."}</blockquote>`,
	];
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), {
		inline_keyboard: [
			[{ text: "🪙 CoinGecko", callback_data: "coingecko:home" }],
			[{ text: en ? "💵 USDT route" : "💵 مسیر دریافت تتر", callback_data: "sources:usdt" }],
			[{ text: en ? "🔄 Refresh" : "🔄 بررسی مجدد", callback_data: "sources:refresh" }],
			[{ text: `⬅️ ${this._tg("managementPanel")}`, callback_data: "menu:home" }],
		],
	});
},

async _showUsdt(message) {
	const sources = await this.s.statuses.all();
	const result = resolveUsdtFromStatuses(sources);
	const en = this._tgLanguage() === "en";
	const text = result.available
		? `<b>💵 ${en ? "USDT route" : "مسیر دریافت تتر"}</b>\n\n<blockquote>✅ ${en ? "Valid cached price" : "قیمت معتبر کش‌شده"}</blockquote>\n\n💰 <b>${formatFaInteger(result.price_toman)} ${en ? "Toman" : "تومان"}</b>\n\n📡 <b>${escapeHtml(result.selected_source)}</b>\n\nWallex → Tabdeal → Exir`
		: `<b>💵 ${en ? "USDT route" : "مسیر دریافت تتر"}</b>\n\n<blockquote>🟡 ${en ? "No cached USDT price" : "قیمت تتر در کش موجود نیست"}</blockquote>\n\nWallex → Tabdeal → Exir`;
	return this.s.telegram.editMessage(message.chat.id, message.message_id, text, {
		inline_keyboard: [
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
	const automation = await this.s.automation.getSettings();
	const next = calculateNextPublishAt(automation);
	const en = this._tgLanguage() === "en";
	const lines = en ? [
		"<b>🕒 Publishing schedule</b>", "",
		`<blockquote>${automation.enabled ? "🟢 Automatic publishing enabled" : "⚪ Automatic publishing disabled"}</blockquote>`, "",
		`⏱ Interval: <b>${automation.intervalMinutes} min</b>`,
		`🌙 Quiet hours: <b>${automation.quietHours.enabled ? `${automation.quietHours.start} – ${automation.quietHours.end}` : "Disabled"}</b>`, "",
		`📤 Last publish: <b>${formatOptionalSystemDateTime(this.s.config, automation.lastSuccessAt)}</b>`,
		`⏭ Next publish: <b>${formatOptionalSystemDateTime(this.s.config, next)}</b>`,
	] : [
		"<b>🕒 زمان‌بندی انتشار</b>", "",
		`<blockquote>${automation.enabled ? "🟢 انتشار خودکار فعال است" : "⚪ انتشار خودکار غیرفعال است"}</blockquote>`, "",
		`⏱ بازه انتشار: <b>${automation.intervalMinutes} دقیقه</b>`,
		`🌙 ساعت استراحت: <b>${automation.quietHours.enabled ? `${automation.quietHours.start} تا ${automation.quietHours.end}` : "غیرفعال"}</b>`, "",
		`📤 آخرین انتشار: <b>${formatOptionalSystemDateTime(this.s.config, automation.lastSuccessAt)}</b>`,
		`⏭ انتشار بعدی: <b>${formatOptionalSystemDateTime(this.s.config, next)}</b>`,
	];
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), {
		inline_keyboard: [
			[{ text: automation.enabled ? (en ? "⏸ Stop automation" : "⏸ توقف انتشار خودکار") : (en ? "▶️ Enable automation" : "▶️ فعال‌سازی انتشار خودکار"), callback_data: "automation:toggle" }],
			[{ text: en ? "🌙 Quiet hours" : "🌙 ساعت استراحت", callback_data: "automation:quiet:edit" }, { text: en ? "⏱ Interval" : "⏱ بازه انتشار", callback_data: "automation:interval" }],
			[{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" }],
		],
	});
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
	return this._minutePicker(message, this._tgLanguage() === "en" ? "<b>🌙 End minute</b>" : "<b>🌙 دقیقه پایان</b>", (minute) => `quiet:end_minute:${startHour}:${startMinute}:${endHour}:${minute}`, "automation:home");
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
