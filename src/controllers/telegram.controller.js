import { telegram_coreMethods } from "./telegram/telegram-core.methods.js";
import { telegram_marketMethods } from "./telegram/telegram-market.methods.js";
import { telegram_settingsMethods } from "./telegram/telegram-settings.methods.js";
import { telegram_systemMethods } from "./telegram/telegram-system.methods.js";

/** Telegram administration controller. */
export class TelegramController {
	constructor(services) {
		this.s = services;
	}
}

Object.assign(
	TelegramController.prototype,
	telegram_coreMethods,
	telegram_marketMethods,
	telegram_settingsMethods,
	telegram_systemMethods,
);
