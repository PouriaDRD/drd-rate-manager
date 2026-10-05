import { APP } from "../../config/app.js";
import { jsonResponse } from "../../http/responses.js";
import { normalizeCommand } from "../../telegram/ui.js";
import { telegramT } from "../../telegram/i18n.js";
import { errorMessage, escapeHtml, pad2, parseBoolean } from "../../utils/core.js";

export const telegram_coreMethods = {
async handleWebhook(request) {
	if (!this._verifyWebhook(request)) return jsonResponse({ success: false, message: "Unauthorized" }, 401);
	await this.s.preferences?.refresh?.();
	const update = await request.json();
	try {
		await this._process(update);
	} catch (error) {
		console.error("telegram.update_failed", { message: errorMessage(error), stack: error?.stack || null });
	}
	return jsonResponse({ success: true });
},

_tgLanguage() {
	return this.s.preferences?.telegramLanguage || "fa";
},

_tg(key) {
	return telegramT(this._tgLanguage(), key);
},

_verifyWebhook(request) {
	const expected = String(
		this.s.env?.TELEGRAM_WEBHOOK_SECRET ?? this.s.config?.telegramWebhookSecret ?? "",
	);
	if (!expected) return true;
	return request.headers.get("X-Telegram-Bot-Api-Secret-Token") === expected;
},

async _process(update) {
	if (update.callback_query) return this._callback(update.callback_query);
	if (update.message) return this._message(update.message);
},

async _message(message) {
	const user = message.from;
	const command = normalizeCommand(message.text || "");
	if (["/start", "/menu", "/help"].includes(command)) this.s.telegram.syncInterface();
	if (command === "/id") {
		return this.s.telegram.sendMessage(
			message.chat.id,
			`<b>🆔 ${this._tg("telegramId")}</b>\n\n<code>${escapeHtml(String(user?.id || ""))}</code>`,
		);
	}

	const admin = await this.s.admins.resolve(user);
	if (!admin) {
		return this.s.telegram.sendMessage(
			message.chat.id,
			`<b>${this._tg("unauthorizedTitle")}</b>\n\n${this._tg("unauthorizedBody")}`,
		);
	}
	await this.s.admins.touchProfile(user);

	const input = await this.s.adminInput.get(user.id);
	if (input?.action === "add_admin" && !command) return this._handleAddAdminInput(message, admin);

	const enabled = parseBoolean(await this.s.settings.get("bot_enabled", "1"), true);
	if (!enabled && admin.role !== "owner") {
		return this.s.telegram.sendMessage(message.chat.id, this._disabledText(admin));
	}

	switch (command) {
		case "/start": return this._sendStart(message.chat.id, admin);
		case "/menu": return this._sendMenu(message.chat.id, admin);
		case "/help": return this._sendHelp(message.chat.id, admin);
		default: return this._sendMenu(message.chat.id, admin);
	}
},

async _callback(query) {
	await this.s.telegram.answerCallback(query.id);
	const user = query.from;
	const message = query.message;
	const admin = await this.s.admins.resolve(user);
	if (!admin) {
		return this.s.telegram.editMessage(message.chat.id, message.message_id, `<b>${this._tg("unauthorizedTitle")}</b>`);
	}
	const data = String(query.data || "");
	const enabled = parseBoolean(await this.s.settings.get("bot_enabled", "1"), true);
	if (!enabled && admin.role !== "owner" && data !== "global:enable") {
		return this.s.telegram.editMessage(message.chat.id, message.message_id, this._disabledText(admin));
	}

	if (data === "menu:home") return this._showMenu(message, admin);
	if (data === "help:home") return this._showHelp(message, admin);
	if (data === "market:home") return this._showMarket(message);
	if (data === "market:refresh") return this._showMarket(message, true);
	if (data === "market:preview") return this._showPreview(message);
	if (data === "market:publish") return this._publish(message, user);
	if (data === "sources:home") return this._showSources(message);
	if (data === "sources:refresh") return this._showSources(message, true);
	if (data === "sources:usdt") return this._showUsdt(message);
	if (data.startsWith("sources:toggle:")) {
		const source = data.slice("sources:toggle:".length);
		const enabled = await this.s.sourceSettings.isEnabled(source);
		await this.s.sourceSettings.setEnabled(source, !enabled);
		return this._showSources(message);
	}
	if (data === "sources:priority:rotate") {
		const priority = await this.s.sourceSettings.usdtPriority();
		await this.s.sourceSettings.setUsdtPriority([...priority.slice(1), priority[0]]);
		return this._showUsdt(message);
	}
	if (data === "coingecko:home") return this._showCoinGecko(message);
	if (data === "coingecko:refresh") return this._showCoinGecko(message, true);
	if (data.startsWith("coingecko:toggle:")) {
		await this.s.assets.toggle(data.slice("coingecko:toggle:".length));
		return this._showCoinGecko(message);
	}
	if (data === "settings:home") return this._showSettings(message, admin);
	if (data === "settings:language:toggle") {
		await this.s.preferences.toggleTelegramLanguage();
		return this._showSettings(message, admin);
	}
	if (data === "cache:home") return this._showCacheSettings(message);
	if (data.startsWith("cache:set:")) {
		const seconds = Number(data.slice("cache:set:".length));
		if (APP.cacheTtlOptions.includes(seconds)) await this.s.settings.set("market_cache_ttl_seconds", seconds);
		return this._showCacheSettings(message);
	}
	if (data === "automation:home" || data === "automation:refresh") return this._showAutomation(message);
	if (data === "automation:history") return this._showAutomationHistory(message);
	if (data === "automation:dry-run") return this._showAutomationDryRun(message, user);
	if (data === "automation:force:confirm") return this._confirmAutomationForceRun(message);
	if (data === "automation:force:execute") return this._executeAutomationForceRun(message, user);
	if (data === "automation:toggle") {
		const state = await this.s.automationManagement.state();
		await this.s.automationManagement.updateSettings({ enabled: !state.settings.enabled });
		return this._showAutomation(message);
	}
	if (data === "automation:interval") return this._showIntervals(message);
	if (data.startsWith("automation:interval:set:")) {
		const minutes = Number(data.slice("automation:interval:set:".length));
		if (APP.publishIntervals.includes(minutes)) {
			await this.s.automationManagement.updateSettings({ interval_minutes: minutes });
		}
		return this._showAutomation(message);
	}
	if (data === "automation:quiet:toggle") {
		const state = await this.s.automationManagement.state();
		await this.s.automationManagement.updateSettings({
			quiet_hours: { enabled: !state.settings.quietHours.enabled },
		});
		return this._showAutomation(message);
	}
	if (data === "automation:quiet:edit") return this._quietStartHour(message);
	if (data.startsWith("quiet:start_hour:")) return this._quietStartMinute(message, Number(data.split(":")[2]));
	if (data.startsWith("quiet:start_minute:")) {
		const [, , hour, minute] = data.split(":");
		return this._quietEndHour(message, Number(hour), Number(minute));
	}
	if (data.startsWith("quiet:end_hour:")) {
		const [, , startHour, startMinute, endHour] = data.split(":");
		return this._quietEndMinute(message, Number(startHour), Number(startMinute), Number(endHour));
	}
	if (data.startsWith("quiet:end_minute:")) {
		const [, , sh, sm, eh, em] = data.split(":");
		await this.s.automationManagement.updateSettings({
			quiet_hours: {
				enabled: true,
				start: `${pad2(sh)}:${pad2(sm)}`,
				end: `${pad2(eh)}:${pad2(em)}`,
			},
		});
		return this._showAutomation(message);
	}
	if (data === "system:home") return this._showSystem(message);
	if (data === "database:home") return this._showDatabase(message);
	if (data === "admins:home") return this._showAdmins(message, admin);
	if (data === "admins:add") return this._beginAddAdmin(message, admin, user);
	if (data.startsWith("admins:view:")) {
		return this._showAdminDetail(message, admin, data.slice("admins:view:".length));
	}
	if (data.startsWith("admins:set:")) {
		const [, , targetId, enabledValue] = data.split(":");
		return this._setAdminEnabled(message, admin, targetId, enabledValue === "1");
	}
	if (data.startsWith("admins:delete:confirm:")) {
		return this._confirmAdminDelete(
			message,
			admin,
			data.slice("admins:delete:confirm:".length),
		);
	}
	if (data.startsWith("admins:delete:execute:")) {
		return this._executeAdminDelete(
			message,
			admin,
			data.slice("admins:delete:execute:".length),
		);
	}
	if (data === "global:disable" && admin.role === "owner") {
		await this.s.settings.set("bot_enabled", "0");
		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			this._disabledText(admin),
			{ inline_keyboard: [[{ text: "▶️ فعال کردن ربات", callback_data: "global:enable" }]] },
		);
	}
	if (data === "global:enable" && admin.role === "owner") {
		await this.s.settings.set("bot_enabled", "1");
		return this._showMenu(message, admin);
	}
}
};
