import { escapeHtml } from "../../utils/core.js";
import { formatOptionalSystemDateTime } from "../../utils/datetime.js";

const TOKEN_PAGE_SIZE = 6;
const EXPIRY_OPTIONS = Object.freeze([
	{ days: 0, fa: "بدون انقضا", en: "Never" },
	{ days: 7, fa: "۷ روز", en: "7 days" },
	{ days: 30, fa: "۳۰ روز", en: "30 days" },
	{ days: 90, fa: "۹۰ روز", en: "90 days" },
	{ days: 365, fa: "۳۶۵ روز", en: "365 days" },
]);

function tokenStatus(token, now = Date.now()) {
	if (token.revokedAt > 0) return "revoked";
	if (token.expiresAt > 0 && token.expiresAt <= now) return "expired";
	return token.enabled ? "enabled" : "disabled";
}

function tokenIcon(token, now = Date.now()) {
	switch (tokenStatus(token, now)) {
		case "enabled": return "🟢";
		case "disabled": return "⚪";
		case "expired": return "🟠";
		default: return "🔴";
	}
}

function clampPage(page, total) {
	const pages = Math.max(1, Math.ceil(total / TOKEN_PAGE_SIZE));
	return Math.min(Math.max(0, Number(page) || 0), pages - 1);
}

function expiryTimestamp(days, now = Date.now()) {
	const value = Number(days);
	if (!Number.isInteger(value) || ![0, 7, 30, 90, 365].includes(value)) {
		throw new Error("Invalid API token expiration preset.");
	}
	return value === 0 ? 0 : now + value * 86_400_000;
}

export const telegram_apiMethods = {
async _showApiManagement(message, admin) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const actor = this._adminActor(admin);
	const snapshot = await this.s.apiManagement.snapshot(actor);
	const en = this._tgLanguage() === "en";
	const mode = snapshot.marketMode === "private" ? "private" : "public";
	const lines = [
		`<b>🔐 ${en ? "API Management" : "مدیریت API"}</b>`,
		"",
		`<blockquote>${mode === "public"
			? (en ? "🌍 Market API is PUBLIC" : "🌍 Market API عمومی است")
			: (en ? "🔒 Market API is PRIVATE" : "🔒 Market API خصوصی است")}</blockquote>`,
		"",
		`${en ? "Total tokens" : "کل توکن‌ها"}: <b>${snapshot.stats.total}</b>`,
		`${en ? "Active" : "فعال"}: <b>${snapshot.stats.active}</b>`,
		`Market: <b>${snapshot.stats.market}</b> · Core: <b>${snapshot.stats.core}</b>`,
		`${en ? "Revoked" : "لغوشده"}: <b>${snapshot.stats.revoked}</b>`,
		"",
		`<blockquote>ℹ️ ${en
			? "Market and Core tokens are isolated. Raw secrets are never recoverable after creation."
			: "توکن‌های Market و Core از هم جدا هستند و Secret خام بعد از ساخت قابل بازیابی نیست."}</blockquote>`,
	];

	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{
			inline_keyboard: [
				[
					{
						text: mode === "public"
							? (en ? "🌐 Market: Public" : "🌐 مارکت: عمومی")
							: (en ? "🔒 Market: Private" : "🔒 مارکت: خصوصی"),
						callback_data: `api:mode:confirm:${mode === "public" ? "private" : "public"}`,
					},
				],
				[
					{ text: en ? "🔑 Tokens" : "🔑 توکن‌ها", callback_data: "api:tokens:0" },
					{ text: en ? "➕ Create token" : "➕ ساخت توکن", callback_data: "api:create" },
				],
				[{ text: en ? "🔄 Refresh" : "🔄 بروزرسانی", callback_data: "api:home" }],
				[{ text: `⬅️ ${this._tg("settings")}`, callback_data: "settings:home" }],
			],
		},
	);
},

async _showApiModeConfirmation(message, admin, mode) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const normalized = String(mode || "").toLowerCase();
	if (!["public", "private"].includes(normalized)) {
		return this._showApiManagementError(message, { code: "invalid_market_mode" });
	}
	const en = this._tgLanguage() === "en";
	const goingPrivate = normalized === "private";
	const warning = goingPrivate
		? (en
			? "Anonymous Market API access will stop immediately. Valid drd_mkt_* tokens will be required."
			: "دسترسی ناشناس Market API فوراً قطع می‌شود و فقط drd_mkt_* معتبر پذیرفته خواهد شد.")
		: (en
			? "Market API will become publicly accessible without authentication."
			: "Market API بدون احراز هویت برای همه قابل دسترسی خواهد شد.");
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		[
			`<b>${goingPrivate ? "🔒" : "🌍"} ${en ? "Change Market API mode" : "تغییر حالت Market API"}</b>`,
			"",
			`<blockquote>⚠️ ${warning}</blockquote>`,
			"",
			`${en ? "New mode" : "حالت جدید"}: <b>${normalized.toUpperCase()}</b>`,
		].join("\n"),
		{
			inline_keyboard: [
				[
					{
						text: en ? "✅ Confirm" : "✅ تأیید",
						callback_data: `api:mode:set:${normalized}`,
					},
				],
				[{ text: en ? "❌ Cancel" : "❌ لغو", callback_data: "api:home" }],
			],
		},
	);
},

async _setApiMarketMode(message, admin, mode) {
	try {
		const actor = this._adminActor(admin);
		await this.s.apiManagement.setMarketMode(mode, actor);
		return this._showApiManagement(message, admin);
	} catch (error) {
		return this._showApiManagementError(message, error);
	}
},

async _showApiTokens(message, admin, page = 0) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const actor = this._adminActor(admin);
	const snapshot = await this.s.apiManagement.snapshot(actor);
	const en = this._tgLanguage() === "en";
	const tokens = snapshot.tokens || [];
	const safePage = clampPage(page, tokens.length);
	const pages = Math.max(1, Math.ceil(tokens.length / TOKEN_PAGE_SIZE));
	const start = safePage * TOKEN_PAGE_SIZE;
	const visible = tokens.slice(start, start + TOKEN_PAGE_SIZE);
	const lines = [
		`<b>🔑 ${en ? "API Tokens" : "توکن‌های API"}</b>`,
		"",
		`${en ? "Page" : "صفحه"} <b>${safePage + 1}/${pages}</b> · ${en ? "Total" : "کل"} <b>${tokens.length}</b>`,
	];
	if (!tokens.length) {
		lines.push("", `<blockquote>${en ? "No API tokens have been created yet." : "هنوز API Token ساخته نشده است."}</blockquote>`);
	}

	const keyboard = visible.map((item) => [{
		text: `${tokenIcon(item)} ${item.type === "market" ? "MKT" : "CORE"} · ${item.name}`,
		callback_data: `api:token:${item.id}`,
	}]);

	if (pages > 1) {
		const navigation = [];
		if (safePage > 0) {
			navigation.push({ text: "⬅️", callback_data: `api:tokens:${safePage - 1}` });
		}
		navigation.push({ text: `${safePage + 1}/${pages}`, callback_data: `api:tokens:${safePage}` });
		if (safePage + 1 < pages) {
			navigation.push({ text: "➡️", callback_data: `api:tokens:${safePage + 1}` });
		}
		keyboard.push(navigation);
	}
	keyboard.push([{ text: en ? "➕ Create token" : "➕ ساخت توکن", callback_data: "api:create" }]);
	keyboard.push([{ text: en ? "⬅️ API Management" : "⬅️ مدیریت API", callback_data: "api:home" }]);

	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{ inline_keyboard: keyboard },
	);
},

async _showApiTokenDetail(message, admin, tokenId) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const actor = this._adminActor(admin);
	const snapshot = await this.s.apiManagement.snapshot(actor);
	const token = snapshot.tokens.find((item) => Number(item.id) === Number(tokenId));
	if (!token) return this._showApiTokens(message, admin, 0);

	const en = this._tgLanguage() === "en";
	const status = tokenStatus(token);
	const labels = {
		enabled: en ? "Enabled" : "فعال",
		disabled: en ? "Disabled" : "غیرفعال",
		expired: en ? "Expired" : "منقضی",
		revoked: en ? "Revoked" : "لغوشده",
	};
	const lines = [
		`<b>🔑 ${escapeHtml(token.name)}</b>`,
		"",
		`${en ? "Type" : "نوع"}: <b>${token.type === "market" ? "Market" : "Core"}</b>`,
		`${en ? "Prefix" : "پیشوند"}: <code>${escapeHtml(token.prefix)}</code>`,
		`${en ? "Status" : "وضعیت"}: <b>${tokenIcon(token)} ${labels[status]}</b>`,
		`${en ? "Usage" : "تعداد استفاده"}: <b>${Number(token.usageCount || 0)}</b>`,
		`${en ? "Last used" : "آخرین استفاده"}: <code>${escapeHtml(formatOptionalSystemDateTime(this.s.config, token.lastUsedAt))}</code>`,
		`${en ? "Created" : "ساخته‌شده"}: <code>${escapeHtml(formatOptionalSystemDateTime(this.s.config, token.createdAt))}</code>`,
		`${en ? "Expires" : "انقضا"}: <code>${token.expiresAt
			? escapeHtml(formatOptionalSystemDateTime(this.s.config, token.expiresAt))
			: (en ? "Never" : "بدون انقضا")}</code>`,
	];
	if (token.revokedAt) {
		lines.push(`${en ? "Revoked" : "زمان لغو"}: <code>${escapeHtml(formatOptionalSystemDateTime(this.s.config, token.revokedAt))}</code>`);
	}

	const keyboard = [];
	if (!token.revokedAt) {
		if (status !== "expired") {
			keyboard.push([{
				text: token.enabled
					? (en ? "⏸ Disable" : "⏸ غیرفعال")
					: (en ? "▶️ Enable" : "▶️ فعال"),
				callback_data: `api:token:set:${token.id}:${token.enabled ? "0" : "1"}`,
			}]);
		}
		keyboard.push([
			{ text: en ? "♻️ Rotate" : "♻️ چرخش", callback_data: `api:token:rotate:confirm:${token.id}` },
			{ text: en ? "🗑 Revoke" : "🗑 لغو", callback_data: `api:token:revoke:confirm:${token.id}` },
		]);
	}
	keyboard.push([{ text: en ? "⬅️ Tokens" : "⬅️ توکن‌ها", callback_data: "api:tokens:0" }]);

	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{ inline_keyboard: keyboard },
	);
},

async _setApiTokenEnabled(message, admin, tokenId, enabled) {
	try {
		const actor = this._adminActor(admin);
		await this.s.apiManagement.setEnabled(tokenId, Boolean(enabled), actor);
		return this._showApiTokenDetail(message, admin, tokenId);
	} catch (error) {
		return this._showApiManagementError(message, error);
	}
},

async _confirmApiTokenRevoke(message, admin, tokenId) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const en = this._tgLanguage() === "en";
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		[
			`<b>🗑 ${en ? "Revoke API token" : "لغو API Token"}</b>`,
			"",
			`<blockquote>⚠️ ${en
				? "Revocation is permanent. This token cannot be enabled again."
				: "لغو دائمی است و این توکن دوباره قابل فعال‌سازی نخواهد بود."}</blockquote>`,
		].join("\n"),
		{
			inline_keyboard: [
				[{ text: en ? "✅ Revoke permanently" : "✅ لغو دائمی", callback_data: `api:token:revoke:execute:${tokenId}` }],
				[{ text: en ? "❌ Cancel" : "❌ لغو عملیات", callback_data: `api:token:${tokenId}` }],
			],
		},
	);
},

async _executeApiTokenRevoke(message, admin, tokenId) {
	try {
		const actor = this._adminActor(admin);
		await this.s.apiManagement.revoke(tokenId, actor);
		return this._showApiTokenDetail(message, admin, tokenId);
	} catch (error) {
		return this._showApiManagementError(message, error);
	}
},

async _confirmApiTokenRotate(message, admin, tokenId) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const en = this._tgLanguage() === "en";
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		[
			`<b>♻️ ${en ? "Rotate API token" : "چرخش API Token"}</b>`,
			"",
			`<blockquote>⚠️ ${en
				? "The current token will be revoked and a replacement secret will be shown once."
				: "توکن فعلی لغو می‌شود و Secret جایگزین فقط یک بار نمایش داده خواهد شد."}</blockquote>`,
		].join("\n"),
		{
			inline_keyboard: [
				[{ text: en ? "✅ Rotate now" : "✅ چرخش", callback_data: `api:token:rotate:execute:${tokenId}` }],
				[{ text: en ? "❌ Cancel" : "❌ لغو", callback_data: `api:token:${tokenId}` }],
			],
		},
	);
},

async _executeApiTokenRotate(message, admin, tokenId) {
	try {
		const actor = this._adminActor(admin);
		const rotated = await this.s.apiManagement.rotate(tokenId, {}, actor);
		return this._showApiSecret(
			message,
			admin,
			rotated.token,
			rotated.record,
			rotated.replacedTokenId,
			"rotate",
		);
	} catch (error) {
		return this._showApiManagementError(message, error);
	}
},

async _showApiCreateType(message, admin) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const en = this._tgLanguage() === "en";
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`<b>➕ ${en ? "Create API token" : "ساخت API Token"}</b>\n\n${en ? "Select the isolated token scope." : "نوع دسترسی مستقل توکن را انتخاب کنید."}`,
		{
			inline_keyboard: [
				[
					{ text: "🌐 Market", callback_data: "api:create:type:market" },
					{ text: "🛡 Core", callback_data: "api:create:type:core" },
				],
				[{ text: en ? "⬅️ API Management" : "⬅️ مدیریت API", callback_data: "api:home" }],
			],
		},
	);
},

async _showApiCreateExpiry(message, admin, type) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const normalized = String(type || "").toLowerCase();
	if (!["market", "core"].includes(normalized)) {
		return this._showApiManagementError(message, { code: "invalid_token_type" });
	}
	const en = this._tgLanguage() === "en";
	const keyboard = EXPIRY_OPTIONS.map((option) => [{
		text: option.days === 0 ? `♾ ${en ? option.en : option.fa}` : `⏳ ${en ? option.en : option.fa}`,
		callback_data: `api:create:expiry:${normalized}:${option.days}`,
	}]);
	keyboard.push([{ text: en ? "⬅️ Token type" : "⬅️ نوع توکن", callback_data: "api:create" }]);

	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		[
			`<b>➕ ${en ? "Create API token" : "ساخت API Token"}</b>`,
			"",
			`${en ? "Type" : "نوع"}: <b>${normalized === "market" ? "Market" : "Core"}</b>`,
			"",
			en ? "Select expiration." : "مدت اعتبار را انتخاب کنید.",
		].join("\n"),
		{ inline_keyboard: keyboard },
	);
},

async _beginApiTokenNameInput(message, admin, user, type, days) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const normalized = String(type || "").toLowerCase();
	if (!["market", "core"].includes(normalized)) {
		return this._showApiManagementError(message, { code: "invalid_token_type" });
	}
	let expiresAt;
	try {
		expiresAt = expiryTimestamp(days);
	} catch {
		return this._showApiManagementError(message, { code: "invalid_expiration" });
	}
	await this.s.adminInput.set(user.id, "api_token_name", {
		type: normalized,
		expiresAt,
	});
	const en = this._tgLanguage() === "en";
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		[
			`<b>✍️ ${en ? "Token name" : "نام توکن"}</b>`,
			"",
			`${en ? "Type" : "نوع"}: <b>${normalized === "market" ? "Market" : "Core"}</b>`,
			`${en ? "Expiration" : "انقضا"}: <b>${expiresAt
				? escapeHtml(formatOptionalSystemDateTime(this.s.config, expiresAt))
				: (en ? "Never" : "بدون انقضا")}</b>`,
			"",
			en
				? "Send a name for this token (1–80 characters)."
				: "یک نام برای این توکن ارسال کنید (۱ تا ۸۰ کاراکتر).",
		].join("\n"),
		{
			inline_keyboard: [[{
				text: en ? "❌ Cancel" : "❌ لغو",
				callback_data: "api:create:cancel",
			}]],
		},
	);
},

async _handleApiTokenNameInput(message, admin, input) {
	const en = this._tgLanguage() === "en";
	if (admin.role !== "owner") {
		await this.s.adminInput.clear(message.from.id);
		return this.s.telegram.sendMessage(
			message.chat.id,
			`🔒 ${en ? "Only the owner can manage API access." : "فقط مالک می‌تواند دسترسی API را مدیریت کند."}`,
		);
	}
	try {
		const actor = this._adminActor(admin, message.from?.id);
		const created = await this.s.apiManagement.create(
			{
				name: message.text,
				type: input?.payload?.type,
				expiresAt: input?.payload?.expiresAt || 0,
			},
			actor,
		);
		await this.s.adminInput.clear(message.from.id);
		return this.s.telegram.sendMessage(
			message.chat.id,
			this._apiSecretText(created.token, created.record, "create"),
			{
				inline_keyboard: [
					[{ text: en ? "✅ Saved — hide secret" : "✅ ذخیره کردم — مخفی کن", callback_data: `api:secret:hide:${created.record.id}` }],
					[{ text: en ? "🔑 Token details" : "🔑 جزئیات توکن", callback_data: `api:token:${created.record.id}` }],
				],
			},
		);
	} catch (error) {
		return this.s.telegram.sendMessage(
			message.chat.id,
			`<b>➕ ${en ? "Create API token" : "ساخت API Token"}</b>\n\n<blockquote>🔴 ${escapeHtml(this._apiManagementErrorText(error, en))}</blockquote>\n\n${en ? "Send another token name or cancel from API Management." : "نام دیگری ارسال کنید یا از مدیریت API عملیات را لغو کنید."}`,
			{
				inline_keyboard: [[{
					text: en ? "❌ Cancel" : "❌ لغو",
					callback_data: "api:create:cancel",
				}]],
			},
		);
	}
},

async _cancelApiTokenInput(message, admin, user) {
	await this.s.adminInput.clear(user.id);
	return this._showApiManagement(message, admin);
},

async _showApiSecret(message, admin, rawToken, record, replacedTokenId, action) {
	if (admin.role !== "owner") return this._showApiOwnerRequired(message);
	const en = this._tgLanguage() === "en";
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		this._apiSecretText(rawToken, record, action),
		{
			inline_keyboard: [
				[{ text: en ? "✅ Saved — hide secret" : "✅ ذخیره کردم — مخفی کن", callback_data: `api:secret:hide:${record.id}` }],
				[{ text: en ? "🔑 New token details" : "🔑 جزئیات توکن جدید", callback_data: `api:token:${record.id}` }],
				...(replacedTokenId ? [[{
					text: en ? "↩ Replaced token" : "↩ توکن قبلی",
					callback_data: `api:token:${replacedTokenId}`,
				}]] : []),
			],
		},
	);
},

_apiSecretText(rawToken, record, action) {
	const en = this._tgLanguage() === "en";
	const title = action === "rotate"
		? (en ? "♻️ Token rotated" : "♻️ توکن چرخانده شد")
		: (en ? "✅ Token created" : "✅ توکن ساخته شد");
	return [
		`<b>${title}</b>`,
		"",
		`<blockquote>⚠️ ${en
			? "ONE-TIME SECRET — it cannot be recovered from the server later."
			: "SECRET یک‌باره — بعداً از سرور قابل بازیابی نیست."}</blockquote>`,
		"",
		`<code>${escapeHtml(rawToken)}</code>`,
		"",
		`${en ? "Name" : "نام"}: <b>${escapeHtml(record.name)}</b>`,
		`${en ? "Type" : "نوع"}: <b>${record.type === "market" ? "Market" : "Core"}</b>`,
		`${en ? "Prefix" : "پیشوند"}: <code>${escapeHtml(record.prefix)}</code>`,
	].join("\n");
},

async _hideApiSecret(message, admin, tokenId) {
	return this._showApiTokenDetail(message, admin, tokenId);
},

_showApiOwnerRequired(message) {
	const en = this._tgLanguage() === "en";
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`<b>🔐 ${en ? "API Management" : "مدیریت API"}</b>\n\n<blockquote>🔒 ${en ? "Only the owner can manage API access." : "فقط مالک می‌تواند دسترسی API را مدیریت کند."}</blockquote>`,
		{
			inline_keyboard: [[{
				text: `⬅️ ${this._tg("settings")}`,
				callback_data: "settings:home",
			}]],
		},
	);
},

_showApiManagementError(message, error) {
	const en = this._tgLanguage() === "en";
	return this.s.telegram.editMessage(
		message.chat.id,
		message.message_id,
		`<b>🔐 ${en ? "API Management" : "مدیریت API"}</b>\n\n<blockquote>🔴 ${escapeHtml(this._apiManagementErrorText(error, en))}</blockquote>`,
		{
			inline_keyboard: [[{
				text: en ? "⬅️ API Management" : "⬅️ مدیریت API",
				callback_data: "api:home",
			}]],
		},
	);
},

_apiManagementErrorText(error, en) {
	switch (error?.code) {
		case "owner_required":
			return en ? "Only the owner can manage API access." : "فقط مالک می‌تواند دسترسی API را مدیریت کند.";
		case "token_not_found":
			return en ? "API token not found." : "API Token پیدا نشد.";
		case "token_revoked":
			return en ? "Revoked tokens are immutable." : "توکن لغوشده قابل تغییر نیست.";
		case "invalid_token_id":
			return en ? "Invalid API token ID." : "شناسه API Token نامعتبر است.";
		case "invalid_token_type":
			return en ? "Invalid token type." : "نوع توکن نامعتبر است.";
		case "invalid_token_name":
			return en ? "Token name must contain 1–80 characters." : "نام توکن باید بین ۱ تا ۸۰ کاراکتر باشد.";
		case "invalid_expiration":
			return en ? "Invalid token expiration." : "زمان انقضای توکن نامعتبر است.";
		case "invalid_market_mode":
			return en ? "Invalid Market API mode." : "حالت Market API نامعتبر است.";
		default:
			return en ? "API management operation failed." : "عملیات مدیریت API ناموفق بود.";
	}
},
};

export const TELEGRAM_API_MANAGEMENT = Object.freeze({
	pageSize: TOKEN_PAGE_SIZE,
	expiryDays: Object.freeze(EXPIRY_OPTIONS.map((item) => item.days)),
	tokenStatus,
	clampPage,
	expiryTimestamp,
});
