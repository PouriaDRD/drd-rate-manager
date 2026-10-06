import { escapeHtml } from "../../utils/core.js";
import { telegramChannelUrl } from "../../services/required-membership.service.js";

function channelCallbackValue(username) {
	return String(username || "").replace(/^@/, "");
}

function channelLine(item, en) {
	const lock = item.immutable ? "🔒" : "▫️";
	const kind = item.immutable
		? en
			? "mandatory"
			: "اجباری"
		: en
			? "extra"
			: "اضافی";
	return `${lock} <code>${escapeHtml(item.username)}</code> · ${kind}`;
}

export const telegram_membershipMethods = {
	async _enforceRequiredMembership(message, admin, userId, { edit = false } = {}) {
		if (admin?.role === "owner") return true;
		const status = await this.s.requiredMembership.checkUser(userId);
		if (status.ok) return true;
		await this._showRequiredMembershipGate(message, status, { edit });
		return false;
	},

	async _recheckRequiredMembership(message, admin, userId) {
		if (admin?.role === "owner") return this._showMenu(message, admin);
		const status = await this.s.requiredMembership.checkUser(userId);
		if (status.ok) return this._showMenu(message, admin);
		return this._showRequiredMembershipGate(message, status, { edit: true });
	},

	async _showRequiredMembershipGate(message, status, { edit = false } = {}) {
		const en = this._tgLanguage() === "en";
		const lines = [
			`<b>📣 ${en ? "Required channel membership" : "عضویت اجباری در کانال‌ها"}</b>`,
			"",
			`<blockquote>${en
				? "Join every required channel, then tap Check membership."
				: "ابتدا عضو همه کانال‌های اجباری شوید و سپس بررسی عضویت را بزنید."}</blockquote>`,
		];

		for (const item of status.channels || []) {
			const icon = item.member ? "✅" : item.unavailable ? "⚠️" : "❌";
			const label = item.member
				? en
					? "member"
					: "عضو"
				: item.unavailable
					? en
						? "verification unavailable"
						: "بررسی عضویت در دسترس نیست"
					: en
						? "not joined"
						: "عضو نیستید";
			lines.push(`${icon} <code>${escapeHtml(item.username)}</code> · ${label}`);
		}

		if (status.unavailable?.length) {
			lines.push(
				"",
				`<blockquote>⚠️ ${en
					? "Membership verification failed for at least one channel. The bot must be an administrator in every required channel."
					: "بررسی عضویت حداقل یک کانال ناموفق بود. ربات باید در تمام کانال‌های اجباری Administrator باشد."}</blockquote>`,
			);
		}

		const keyboard = (status.channels || [])
			.filter((item) => !item.member)
			.map((item) => [
				{
					text: `📣 ${item.username}`,
					url: telegramChannelUrl(item.username),
				},
			]);
		keyboard.push([
			{
				text: en ? "✅ Check membership" : "✅ بررسی عضویت",
				callback_data: "membership:check",
			},
		]);

		if (edit && message?.message_id != null) {
			return this.s.telegram.editMessage(
				message.chat.id,
				message.message_id,
				lines.join("\n"),
				{ inline_keyboard: keyboard },
			);
		}
		return this.s.telegram.sendMessage(message.chat.id, lines.join("\n"), {
			inline_keyboard: keyboard,
		});
	},

	async _showMembershipSettings(message, admin) {
		if (admin?.role !== "owner") return this._showMembershipOwnerRequired(message);
		const snapshot = await this.s.requiredMembership.snapshot();
		const en = this._tgLanguage() === "en";
		const lines = [
			`<b>📣 ${en ? "Required memberships" : "عضویت‌های اجباری"}</b>`,
			"",
			`<blockquote>${en
				? "DRDNetwork and DRDrate are permanent. Extra public channels can be managed by the owner."
				: "DRDNetwork و DRDrate دائمی و غیرقابل‌حذف هستند. Owner می‌تواند کانال عمومی اضافی مدیریت کند."}</blockquote>`,
			"",
			`<b>${en ? "Channels" : "کانال‌ها"}</b>`,
			...snapshot.channels.map((item) => channelLine(item, en)),
			"",
			`${en ? "Extra slots" : "ظرفیت کانال اضافی"}: <b>${snapshot.extra.length}/${snapshot.maxExtra}</b>`,
			`<blockquote>ℹ️ ${en
				? "The owner bypasses membership enforcement to prevent administrative lockout. The bot must be an administrator in every required channel."
				: "برای جلوگیری از قفل مدیریتی، Owner از اجبار عضویت مستثناست. ربات باید در تمام کانال‌های اجباری Administrator باشد."}</blockquote>`,
		];

		const keyboard = snapshot.channels.map((item) => {
			const row = [
				{
					text: `${item.immutable ? "🔒" : "📣"} ${item.username}`,
					url: telegramChannelUrl(item.username),
				},
			];
			if (!item.immutable) {
				row.push({
					text: "🗑",
					callback_data: `membership:remove:confirm:${channelCallbackValue(item.username)}`,
				});
			}
			return row;
		});
		if (snapshot.extra.length < snapshot.maxExtra) {
			keyboard.push([
				{
					text: en ? "➕ Add required channel" : "➕ افزودن کانال اجباری",
					callback_data: "membership:add",
				},
			]);
		}
		keyboard.push([
			{ text: en ? "🔄 Refresh" : "🔄 بروزرسانی", callback_data: "membership:home" },
		]);
		keyboard.push([
			{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" },
		]);

		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			lines.join("\n"),
			{ inline_keyboard: keyboard },
		);
	},

	async _beginRequiredChannelAdd(message, admin, user) {
		if (admin?.role !== "owner") return this._showMembershipOwnerRequired(message);
		const en = this._tgLanguage() === "en";
		await this.s.adminInput.set(user.id, "required_channel_add");
		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			en
				? "<b>➕ Add required channel</b>\n\nSend a public channel username such as <code>@ExampleChannel</code> or its <code>t.me/ExampleChannel</code> link.\n\n<blockquote>ℹ️ Add this bot as an Administrator in the channel first.</blockquote>"
				: "<b>➕ افزودن کانال اجباری</b>\n\nنام کاربری عمومی کانال مثل <code>@ExampleChannel</code> یا لینک <code>t.me/ExampleChannel</code> را ارسال کنید.\n\n<blockquote>ℹ️ ابتدا این ربات را در کانال Administrator کنید.</blockquote>",
			{
				inline_keyboard: [
					[{ text: en ? "❌ Cancel" : "❌ لغو", callback_data: "membership:home" }],
				],
			},
		);
	},

	async _handleRequiredChannelInput(message, admin) {
		const en = this._tgLanguage() === "en";
		try {
			const result = await this.s.requiredMembership.add(
				message.text,
				this._membershipActor(admin, message.from?.id),
			);
			await this.s.adminInput.clear(message.from.id);
			return this.s.telegram.sendMessage(
				message.chat.id,
				result.changed
					? `✅ ${en ? "Required channel added" : "کانال اجباری اضافه شد"}: <code>${escapeHtml(result.username)}</code>`
					: `ℹ️ ${en ? "Channel was already required" : "این کانال از قبل اجباری بود"}: <code>${escapeHtml(result.username)}</code>`,
				{
					inline_keyboard: [
						[
							{
								text: en ? "📣 Required memberships" : "📣 عضویت‌های اجباری",
								callback_data: "membership:home",
							},
						],
					],
				},
			);
		} catch (error) {
			return this.s.telegram.sendMessage(
				message.chat.id,
				`🔴 ${escapeHtml(this._requiredMembershipErrorText(error, en))}`,
				{
					inline_keyboard: [
						[
							{
								text: en ? "📣 Required memberships" : "📣 عضویت‌های اجباری",
								callback_data: "membership:home",
							},
						],
					],
				},
			);
		}
	},

	async _confirmRequiredChannelRemove(message, admin, rawChannel) {
		if (admin?.role !== "owner") return this._showMembershipOwnerRequired(message);
		const en = this._tgLanguage() === "en";
		const username = `@${String(rawChannel || "").replace(/^@/, "")}`;
		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			`<b>🗑 ${en ? "Remove required channel" : "حذف کانال اجباری"}</b>\n\n<blockquote>⚠️ ${
				en ? "Remove" : "حذف"
			} <code>${escapeHtml(username)}</code>?</blockquote>`,
			{
				inline_keyboard: [
					[
						{
							text: en ? "✅ Confirm removal" : "✅ تأیید حذف",
							callback_data: `membership:remove:execute:${channelCallbackValue(username)}`,
						},
					],
					[{ text: en ? "❌ Cancel" : "❌ لغو", callback_data: "membership:home" }],
				],
			},
		);
	},

	async _executeRequiredChannelRemove(message, admin, rawChannel) {
		try {
			await this.s.requiredMembership.remove(
				`@${String(rawChannel || "").replace(/^@/, "")}`,
				this._membershipActor(admin),
			);
			return this._showMembershipSettings(message, admin);
		} catch (error) {
			const en = this._tgLanguage() === "en";
			return this.s.telegram.editMessage(
				message.chat.id,
				message.message_id,
				`<b>📣 ${en ? "Required memberships" : "عضویت‌های اجباری"}</b>\n\n<blockquote>🔴 ${escapeHtml(this._requiredMembershipErrorText(error, en))}</blockquote>`,
				{
					inline_keyboard: [
						[
							{
								text: en ? "⬅️ Required memberships" : "⬅️ عضویت‌های اجباری",
								callback_data: "membership:home",
							},
						],
					],
				},
			);
		}
	},

	_showMembershipOwnerRequired(message) {
		const en = this._tgLanguage() === "en";
		return this.s.telegram.editMessage(
			message.chat.id,
			message.message_id,
			`<b>🔒 ${en ? "Owner access required" : "دسترسی Owner لازم است"}</b>\n\n${
				en
					? "Only the bot owner can manage required channels."
					: "فقط Owner ربات می‌تواند کانال‌های اجباری را مدیریت کند."
			}`,
			{
				inline_keyboard: [
					[{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" }],
				],
			},
		);
	},

	_membershipActor(admin, fallbackUserId = null) {
		return {
			type: "telegram",
			role: admin?.role || "admin",
			id: admin?.userId || fallbackUserId || admin?.user?.id || null,
		};
	},

	_requiredMembershipErrorText(error, en) {
		switch (error?.code) {
			case "owner_required":
				return en ? "Only the owner can manage required channels." : "فقط Owner می‌تواند کانال‌های اجباری را مدیریت کند.";
			case "invalid_channel":
				return en ? "Send a valid public Telegram channel username." : "یک نام کاربری عمومی معتبر برای کانال Telegram ارسال کنید.";
			case "channel_immutable":
				return en ? "Mandatory DRD channels are immutable." : "کانال‌های اجباری DRD قابل تغییر یا حذف نیستند.";
			case "channel_limit":
				return en ? "Maximum extra required channels reached." : "ظرفیت کانال‌های اجباری اضافی تکمیل شده است.";
			case "invalid_channel_type":
				return en ? "Only Telegram channels or supergroups are supported." : "فقط Channel یا Supergroup تلگرام پشتیبانی می‌شود.";
			case "public_channel_required":
				return en ? "The required channel must have a public username." : "کانال اجباری باید نام کاربری عمومی داشته باشد.";
			case "bot_admin_required":
				return en ? "Make the bot an Administrator in that channel first." : "ابتدا ربات را در آن کانال Administrator کنید.";
			case "channel_unavailable":
			case "channel_verification_failed":
				return en ? "Telegram could not verify that channel." : "Telegram نتوانست کانال را تأیید کند.";
			case "channel_not_found":
				return en ? "Required channel not found." : "کانال اجباری پیدا نشد.";
			default:
				return en ? "Required membership operation failed." : "عملیات عضویت اجباری ناموفق بود.";
		}
	},
};
