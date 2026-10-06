import { HttpClient } from "./http.client.js";
import { errorMessage } from "../utils/core.js";

let telegramSyncPromise = null;

/** Telegram Bot API client. */
export class TelegramClient {
	constructor(env, http = new HttpClient()) {
		this.env = env;
		this.http = http;
	}

	async api(method, payload = {}) {
		if (!this.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is missing");
		const response = await this.http.fetch(
			`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			},
			10_000,
		);
		let data;
		try {
			data = await response.json();
		} catch {
			data = null;
		}
		if (!response.ok || !data?.ok) {
			const description = data?.description || `HTTP ${response.status}`;
			if (
				method === "editMessageText" &&
				String(description).toLowerCase().includes("message is not modified")
			) {
				return null;
			}
			const error = new Error(description);
			error.status = response.status;
			throw error;
		}
		return data.result;
	}

	getMe() {
		return this.api("getMe");
	}

	getChat(chatId) {
		return this.api("getChat", { chat_id: chatId });
	}

	getChatMember(chatId, userId) {
		return this.api("getChatMember", {
			chat_id: chatId,
			user_id: Number(userId),
		});
	}

	sendMessage(chatId, text, replyMarkup = null) {
		return this.api("sendMessage", {
			chat_id: chatId,
			text,
			parse_mode: "HTML",
			disable_web_page_preview: true,
			...(replyMarkup ? { reply_markup: replyMarkup } : {}),
		});
	}

	editMessage(chatId, messageId, text, replyMarkup = null) {
		return this.api("editMessageText", {
			chat_id: chatId,
			message_id: Number(messageId),
			text,
			parse_mode: "HTML",
			disable_web_page_preview: true,
			...(replyMarkup ? { reply_markup: replyMarkup } : {}),
		});
	}

	sendRichMessage(chatId, richMessage, replyMarkup = null) {
		return this.api("sendRichMessage", {
			chat_id: chatId,
			rich_message: richMessage,
			...(replyMarkup ? { reply_markup: replyMarkup } : {}),
		});
	}

	async editRichMessage(chatId, messageId, richMessage, fallbackText, replyMarkup = null) {
		try {
			return await this.api("editMessageText", {
				chat_id: chatId,
				message_id: Number(messageId),
				rich_message: richMessage,
				...(replyMarkup ? { reply_markup: replyMarkup } : {}),
			});
		} catch (error) {
			console.warn("telegram.rich_edit_fallback", errorMessage(error));
			return this.editMessage(chatId, messageId, fallbackText, replyMarkup);
		}
	}

	async answerCallback(id, text = undefined, showAlert = false) {
		try {
			await this.api("answerCallbackQuery", {
				callback_query_id: id,
				...(text ? { text } : {}),
				show_alert: showAlert,
			});
		} catch {
			// Telegram callback may already be expired.
		}
	}

	async syncInterface() {
		if (!telegramSyncPromise) {
			telegramSyncPromise = Promise.all([
				this.api("setMyCommands", {
					commands: [
						{ command: "start", description: "Start DRD Rate Manager" },
						{ command: "menu", description: "Open management panel" },
						{ command: "help", description: "Show help" },
						{ command: "id", description: "Show your Telegram ID" },
					],
				}),
				this.api("setChatMenuButton", { menu_button: { type: "commands" } }),
			]).catch((error) => {
				telegramSyncPromise = null;
				console.warn("telegram.interface_sync_failed", errorMessage(error));
			});
		}
		return telegramSyncPromise;
	}
}
