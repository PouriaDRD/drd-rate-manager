import { backKeyboard } from "../../telegram/ui.js";
import { errorMessage, escapeHtml } from "../../utils/core.js";
import { formatIranDate, formatIranTime } from "../../utils/datetime.js";

export const telegram_marketMethods = {
async _sendStart(chatId, admin) {
	return this.s.telegram.sendMessage(
		chatId,
		[
			`<b>⚡️ ${escapeHtml(this.s.config.displayName)}</b>`,
			"",
			`${this._tgLanguage() === "fa" ? "نقش شما" : "Your role"}: <b>${this._tg(admin.role === "owner" ? "owner" : "admin")}</b>`,
			"",
			this._tg("startDescription"),
		].join("\n"),
		{ inline_keyboard: [[{ text: `📋 ${this._tg("managementPanel")}`, callback_data: "menu:home" }]] },
	);
},

async _sendMenu(chatId, admin) {
	return this.s.telegram.sendMessage(chatId, this._menuText(admin), this._menuKeyboard());
},

async _showMenu(message, admin) {
	return this.s.telegram.editMessage(message.chat.id, message.message_id, this._menuText(admin), this._menuKeyboard());
},

_menuText(admin) {
	const now = Date.now();
	const roleLabel = this._tg(admin.role === "owner" ? "owner" : "admin");
	return [
		`<b>⚡️ ${escapeHtml(this.s.config.displayName)}</b>`,
		"",
		`${this._tgLanguage() === "fa" ? "نقش" : "Role"}: <b>${roleLabel}</b>`,
		`📅 ${formatIranDate(this.s.config, now)}  ·  🕒 ${formatIranTime(this.s.config, now)}`,
		`Timezone: <code>${escapeHtml(this.s.config.timezone)}</code>`,
		"",
		`<blockquote>ℹ️ ${this._tg("selectAction")}</blockquote>`,
		"",
		`Version: <code>${escapeHtml(this.s.config.version)}</code>`,
	].join("\n");
},

_menuKeyboard() {
	return {
		inline_keyboard: [
			[{ text: `📈 ${this._tg("market")}`, callback_data: "market:home" }],
			[
				{ text: `📡 ${this._tg("sources")}`, callback_data: "sources:home" },
				{ text: `👥 ${this._tg("admins")}`, callback_data: "admins:home" },
			],
			[
				{ text: `⚙️ ${this._tg("settings")}`, callback_data: "settings:home" },
				{ text: `❓ ${this._tg("help")}`, callback_data: "help:home" },
			],
		],
	};
},

async _sendHelp(chatId, admin) {
	return this.s.telegram.sendMessage(chatId, this._helpText(admin));
},

async _showHelp(message, admin) {
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		this._helpText(admin),
		backKeyboard(this._tg("managementPanel"), "menu:home"),
	);
},

_helpText(admin) {
	if (this._tgLanguage() === "en") {
		return [
			`<b>${this._tg("helpTitle")}</b>`, "", `<b>${this._tg("commands")}</b>`,
			`<code>/start</code> ${this._tg("start")}`,
			`<code>/menu</code> ${this._tg("menu")}`,
			`<code>/help</code> ${this._tg("help")}`,
			`<code>/id</code> ${this._tg("telegramId")}`,
			"", "<b>📈 Market</b>", "Cached data, preview, manual publish and forced refresh.",
			"", "<b>📡 Sources</b>", "USDT: Wallex → Tabdeal → Exir", "Crypto + Global Metals: CoinGecko", "Iran Gold: WallGold",
			"", "<b>🗃 Market cache</b>", "Bot/API/Cron share one D1 market snapshot.",
			"", "<b>🤖 Automation</b>", "Cron checks every minute and publishes only on aligned slots outside quiet hours.",
			"", `Role: <code>${admin.role}</code>`, `Timezone: <code>${escapeHtml(this.s.config.timezone)}</code>`, `Version: <code>${escapeHtml(this.s.config.version)}</code>`,
		].join("\n");
	}
	return [
		"<b>❓ راهنمای DRD RATE MANAGER</b>", "", "<b>دستورات</b>",
		"<code>/start</code> شروع", "<code>/menu</code> پنل مدیریت", "<code>/help</code> راهنما", "<code>/id</code> شناسه تلگرام",
		"", "<b>📈 مدیریت بازار</b>", "نمایش داده کش‌شده، پیش‌نمایش، انتشار دستی و بروزرسانی اجباری.",
		"", "<b>📡 منابع</b>", "USDT: Wallex → Tabdeal → Exir", "Crypto + Global Metals: CoinGecko", "Iran Gold: WallGold",
		"", "<b>🗃 کش بازار</b>", "تمام Bot/API/Cron از یک Snapshot مرکزی D1 استفاده می‌کنند.",
		"", "<b>🤖 انتشار خودکار</b>", "Cron هر دقیقه وضعیت را بررسی می‌کند؛ انتشار فقط در موعد و خارج Quiet Hours انجام می‌شود.",
		"", `Role: <code>${admin.role}</code>`, `Timezone: <code>${escapeHtml(this.s.config.timezone)}</code>`, `Version: <code>${escapeHtml(this.s.config.version)}</code>`,
	].join("\n");
},

async _showMarket(message, force = false) {
	const loading = this._tgLanguage() === "en" ? "⏳ Reading market snapshot..." : "⏳ در حال خواندن کش بازار...";
	await this.s.telegram.editMessage(message.chat.id, message.message_id, `<b>📈 ${this._tg("market")}</b>\n\n${loading}`, backKeyboard(this._tg("managementPanel"), "menu:home"));
	const snapshot = await this.s.market.getSnapshot({ forceRefresh: force });
	const publishable = snapshot.quality?.publishable !== false;
	const text = this._tgLanguage() === "en"
		? `<b>📈 Market management</b>\n\n<blockquote>${snapshot.partial ? "🟡 Partial snapshot" : "🟢 Market snapshot is healthy"}</blockquote>\n\nUSDT: <b>${snapshot.usdt?.price ?? "—"}</b>\nCrypto assets: <b>${snapshot.crypto?.length || 0}</b>\nCache: <b>${snapshot.cache?.fromCache ? "HIT" : "REFRESHED"}</b>`
		: `<b>📈 مدیریت بازار</b>\n\n<blockquote>${snapshot.partial ? "🟡 بخشی از اطلاعات از آخرین کش سالم تکمیل شده است" : "🟢 همه‌چیز آماده انتشار است"}</blockquote>\n\nتتر: <b>${snapshot.usdt?.price ?? "—"}</b>\nرمزارزهای فعال: <b>${snapshot.crypto?.length || 0}</b>\nکش: <b>${snapshot.cache?.fromCache ? "استفاده شد" : "بروزرسانی شد"}</b>`;
	const marketActions = publishable
		? [
			{ text: this._tgLanguage() === "en" ? "🚀 Publish now" : "🚀 انتشار اکنون", callback_data: "market:publish" },
			{ text: this._tgLanguage() === "en" ? "📄 Preview" : "📄 پیش‌نمایش", callback_data: "market:preview" },
		]
		: [
			{ text: this._tgLanguage() === "en" ? "📄 Preview" : "📄 پیش‌نمایش", callback_data: "market:preview" },
		];
	return this.s.telegram.editMessage(message.chat.id, message.message_id, text, {
		inline_keyboard: [
			marketActions,
			[{ text: this._tgLanguage() === "en" ? "🔄 Refresh" : "🔄 بروزرسانی", callback_data: "market:refresh" }],
			[{ text: `⬅️ ${this._tg("managementPanel")}`, callback_data: "menu:home" }],
		],
	});
},

async _showPreview(message) {
	const snapshot = await this.s.market.getSnapshot();
	const rich = this.s.postBuilder.buildRichMessage(snapshot);
	const previewKeyboard = snapshot.quality?.publishable === false
		? [
			[{ text: this._tgLanguage() === "en" ? "🔄 Refresh" : "🔄 بروزرسانی", callback_data: "market:refresh" }],
			[{ text: `⬅️ ${this._tg("market")}`, callback_data: "market:home" }],
		]
		: [
			[{ text: this._tgLanguage() === "en" ? "🚀 Publish now" : "🚀 انتشار اکنون", callback_data: "market:publish" }],
			[{ text: `⬅️ ${this._tg("market")}`, callback_data: "market:home" }],
		];
	return this.s.telegram.editRichMessage(
		message.chat.id,
		message.message_id,
		rich,
		this.s.postBuilder.buildFallbackHtml(snapshot),
		{ inline_keyboard: previewKeyboard },
	);
},

async _publish(message, user) {
	try {
		const snapshot = await this.s.market.getSnapshot();
		const result = await this.s.publisher.publish(snapshot);
		await this.s.audit.add(user.id, "market.manual_published", { messageId: result?.message_id ?? null, partial: snapshot.partial });
		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			this._tgLanguage() === "en" ? "<b>🚀 Market publish</b>\n\n<blockquote>✅ Published successfully</blockquote>" : "<b>🚀 انتشار بازار</b>\n\n<blockquote>✅ پست با موفقیت منتشر شد</blockquote>",
			backKeyboard(this._tg("market"), "market:home"),
		);
	} catch (error) {
		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			`<b>🚀 ${this._tg("market")}</b>\n\n🔴 ${this._tgLanguage() === "en" ? "Publishing failed." : "ارسال پیام به کانال ناموفق بود."}\n\n<code>${escapeHtml(errorMessage(error))}</code>`,
			backKeyboard(this._tg("market"), "market:home"),
		);
	}
}
};
