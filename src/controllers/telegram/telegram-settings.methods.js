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

export const telegram_settingsMethods = {
async _showSources(message, force = false) {
	if (force) await this.s.market.forceRefreshSources();
	const sources = await this.s.statuses.all();
	const lines = [
		"<b>📡 مدیریت منابع</b>",
		"",
		"<b>💵 تتر / تومان</b>",
		"",
		sourceStatusText("Wallex", sources.wallex, "Primary"),
		"",
		sourceStatusText("Tabdeal", sources.tabdeal, "Fallback #1"),
		"",
		sourceStatusText("Exir", sources.exir, "Fallback #2"),
		"",
		"<b>🪙 رمزارزها و فلزات جهانی</b>",
		"",
		sourceStatusText("CoinGecko", sources.coingecko),
		"",
		"<b>🥇 طلای ایران</b>",
		"",
		sourceStatusText("WallGold", sources.wallgold),
		"",
		"<blockquote>ℹ️ این صفحه فقط از وضعیت کش‌شده D1 می‌خواند. «بررسی مجدد» منابع را بروزرسانی می‌کند.</blockquote>",
	];
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), {
		inline_keyboard: [
			[{ text: "🪙 مدیریت CoinGecko", callback_data: "coingecko:home" }],
			[{ text: "💵 مسیر دریافت تتر", callback_data: "sources:usdt" }],
			[{ text: "🔄 بررسی مجدد", callback_data: "sources:refresh" }],
			[{ text: "⬅️ پنل مدیریت", callback_data: "menu:home" }],
		],
	});
},

async _showUsdt(message) {
	const sources = await this.s.statuses.all();
	const result = resolveUsdtFromStatuses(sources);
	const text = result.available
		? `<b>💵 مسیر دریافت تتر</b>\n\n<blockquote>✅ قیمت معتبر کش‌شده</blockquote>\n\n💰 <b>${formatFaInteger(result.price_toman)} تومان</b>\n\n📡 <b>${escapeHtml(result.selected_source)}</b>\n\nWallex → Tabdeal → Exir`
		: "<b>💵 مسیر دریافت تتر</b>\n\n<blockquote>🟡 قیمت تتر در کش موجود نیست</blockquote>\n\nWallex → Tabdeal → Exir";
	return this.s.telegram.editMessage(message.chat.id, message.message_id, text, {
		inline_keyboard: [
			[{ text: "🔄 بروزرسانی منابع", callback_data: "sources:refresh" }],
			[{ text: "⬅️ مدیریت منابع", callback_data: "sources:home" }],
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
	const lines = [
		"<b>🪙 مدیریت CoinGecko</b>",
		"",
		`<blockquote>${refreshError ? `🔴 ${escapeHtml(refreshError)}` : `🟢 ${assets.length} دارایی کش‌شده`}</blockquote>`,
		"",
		"با انتخاب هر مورد، نمایش آن در پست‌های بازار فعال/غیرفعال می‌شود.",
	];
	const keyboard = assets.slice(0, this.s.config.coinGeckoTopLimit).map((asset) => [{
		text: `${asset.enabled ? "✅" : "▫️"} ${asset.symbol} · ${asset.name_fa}`,
		callback_data: `coingecko:toggle:${asset.id}`,
	}]);
	keyboard.push([{ text: "🔄 بروزرسانی لیست", callback_data: "coingecko:refresh" }]);
	keyboard.push([{ text: "⬅️ مدیریت منابع", callback_data: "sources:home" }]);
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), {
		inline_keyboard: keyboard,
	});
},

async _showSettings(message, admin) {
	const ttl = await this.s.market.cacheTtlSeconds();
	const enabled = parseBoolean(await this.s.settings.get("bot_enabled", "1"), true);
	const keyboard = [
		[{ text: "🕒 زمان‌بندی انتشار", callback_data: "automation:home" }],
		[{ text: "📊 وضعیت سیستم", callback_data: "system:home" }],
		[{ text: `🗃 کش بازار · ${ttl} ثانیه`, callback_data: "cache:home" }],
	];
	if (admin.role === "owner") {
		keyboard.push([
			{
				text: enabled ? "⏸ غیرفعال کردن ربات" : "▶️ فعال کردن ربات",
				callback_data: enabled ? "global:disable" : "global:enable",
			},
		]);
	}
	keyboard.push([{ text: "⬅️ پنل مدیریت", callback_data: "menu:home" }]);
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`<b>⚙️ تنظیمات</b>\n\n<blockquote>${enabled ? "🟢 سیستم فعال است" : "🔴 سیستم غیرفعال است"}</blockquote>\n\n<blockquote>ℹ️ زمان‌بندی انتشار، وضعیت سیستم و مدت اعتبار کش بازار از این بخش مدیریت می‌شوند. کش فعلی: ${ttl} ثانیه.</blockquote>`,
		{ inline_keyboard: keyboard },
	);
},

async _showCacheSettings(message) {
	const current = await this.s.market.cacheTtlSeconds();
	const keyboard = chunk(
		APP.cacheTtlOptions.map((seconds) => ({
			text: `${seconds === current ? "✅" : "▫️"} ${seconds} ثانیه`,
			callback_data: `cache:set:${seconds}`,
		})),
		2,
	);
	keyboard.push([{ text: "⬅️ تنظیمات", callback_data: "settings:home" }]);
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`<b>🗃 کش بازار</b>\n\nمدت اعتبار فعلی: <b>${current} ثانیه</b>\n\n<blockquote>ℹ️ Bot، API و Cron همگی از همین Snapshot مرکزی استفاده می‌کنند.</blockquote>`,
		{ inline_keyboard: keyboard },
	);
},

async _showAutomation(message) {
	const automation = await this.s.automation.getSettings();
	const next = calculateNextPublishAt(automation);
	const lines = [
		"<b>🕒 زمان‌بندی انتشار</b>",
		"",
		`<blockquote>${automation.enabled ? "🟢 انتشار خودکار فعال است" : "⚪ انتشار خودکار غیرفعال است"}</blockquote>`,
		"",
		`⏱ بازه انتشار: <b>${automation.intervalMinutes} دقیقه</b>`,
		"",
		`🌙 ساعت استراحت: <b>${automation.quietHours.enabled ? `${automation.quietHours.start} تا ${automation.quietHours.end}` : "غیرفعال"}</b>`,
		"",
		`📤 آخرین انتشار: <b>${formatOptionalSystemDateTime(this.s.config, automation.lastSuccessAt)}</b>`,
		`🫀 آخرین Cron Tick: <b>${formatOptionalSystemDateTime(this.s.config, automation.lastTickAt)}</b>`,
		`🎯 آخرین تلاش: <b>${formatOptionalSystemDateTime(this.s.config, automation.lastAttemptAt)}</b>`,
		`⚠️ آخرین خطا: ${automation.lastError ? `<code>${escapeHtml(automation.lastError)}</code>` : "ندارد"}`,
		`ℹ️ وضعیت آخر: <code>${escapeHtml(automation.lastSkipReason || "-")}</code>`,
		"",
		`⏭ انتشار بعدی: <b>${formatOptionalSystemDateTime(this.s.config, next)}</b>`,
		"",
		"<blockquote>ℹ️ Worker هر دقیقه بررسی می‌شود و فقط وقتی بازه انتشار رسیده باشد و داخل ساعت استراحت نباشیم، پست ارسال می‌شود.</blockquote>",
	];
	return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), {
		inline_keyboard: [
			[{
				text: automation.enabled ? "⏸ توقف انتشار خودکار" : "▶️ فعال‌سازی انتشار خودکار",
				callback_data: "automation:toggle",
			}],
			[
				{ text: "🌙 ساعت استراحت", callback_data: "automation:quiet:edit" },
				{ text: "⏱ بازه انتشار", callback_data: "automation:interval" },
			],
			[{
				text: automation.quietHours.enabled ? "🌙 غیرفعال کردن استراحت" : "🌙 فعال کردن استراحت",
				callback_data: "automation:quiet:toggle",
			}],
			[{ text: "🔄 بروزرسانی", callback_data: "automation:home" }],
			[{ text: "⬅️ تنظیمات", callback_data: "settings:home" }],
		],
	});
},

async _showIntervals(message) {
	const automation = await this.s.automation.getSettings();
	const buttons = APP.publishIntervals.map((minutes) => ({
		text: `${minutes === automation.intervalMinutes ? "✅" : "▫️"} ${minutes} دقیقه`,
		callback_data: `automation:interval:set:${minutes}`,
	}));
	const keyboard = chunk(buttons, 3);
	keyboard.push([{ text: "⬅️ زمان‌بندی انتشار", callback_data: "automation:home" }]);
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		"<b>⏱ بازه انتشار</b>\n\nبازه موردنظر را انتخاب کنید.",
		{ inline_keyboard: keyboard },
	);
},

_quietStartHour(message) {
	return this._hourPicker(
		message,
		"<b>🌙 ساعت شروع استراحت</b>",
		(hour) => `quiet:start_hour:${hour}`,
		"automation:home",
	);
},

_quietStartMinute(message, hour) {
	return this._minutePicker(
		message,
		"<b>🌙 دقیقه شروع</b>",
		(minute) => `quiet:start_minute:${hour}:${minute}`,
		"automation:home",
	);
},

_quietEndHour(message, startHour, startMinute) {
	return this._hourPicker(
		message,
		"<b>🌙 ساعت پایان استراحت</b>",
		(hour) => `quiet:end_hour:${startHour}:${startMinute}:${hour}`,
		"automation:home",
	);
},

_quietEndMinute(message, startHour, startMinute, endHour) {
	return this._minutePicker(
		message,
		"<b>🌙 دقیقه پایان</b>",
		(minute) => `quiet:end_minute:${startHour}:${startMinute}:${endHour}:${minute}`,
		"automation:home",
	);
},

_hourPicker(message, title, callback, back) {
	const buttons = Array.from({ length: 24 }, (_, hour) => ({
		text: pad2(hour),
		callback_data: callback(hour),
	}));
	const keyboard = chunk(buttons, 4);
	keyboard.push([{ text: "⬅️ بازگشت", callback_data: back }]);
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`${title}\n\nساعت را انتخاب کنید.`,
		{ inline_keyboard: keyboard },
	);
},

_minutePicker(message, title, callback, back) {
	const keyboard = [
		APP.quietMinuteOptions.map((minute) => ({
			text: pad2(minute),
			callback_data: callback(minute),
		})),
		[{ text: "⬅️ بازگشت", callback_data: back }],
	];
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`${title}\n\nدقیقه را انتخاب کنید.`,
		{ inline_keyboard: keyboard },
	);
}
};
