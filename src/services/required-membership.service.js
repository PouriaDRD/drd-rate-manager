export const REQUIRED_MEMBERSHIP_MANDATORY_CHANNELS = Object.freeze([
	Object.freeze({ username: "@DRDNetwork", immutable: true }),
	Object.freeze({ username: "@DRDrate", immutable: true }),
]);

export const REQUIRED_MEMBERSHIP_MAX_EXTRA_CHANNELS = 10;

const MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);
const ALLOWED_CHAT_TYPES = new Set(["channel", "supergroup"]);

function errorWithCode(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function channelKey(value) {
	return String(value || "").trim().toLowerCase();
}

function actorId(actor) {
	return actor?.id == null ? null : String(actor.id);
}

function assertOwner(actor) {
	if (actor?.role !== "owner") {
		throw errorWithCode("owner_required", "Only the owner can manage required channels.");
	}
}

export function normalizeRequiredChannel(value) {
	let text = String(value || "").trim();
	if (!text) throw errorWithCode("invalid_channel", "Channel username is required.");

	text = text.replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i, "");
	text = text.replace(/^(?:www\.)?(?:t\.me|telegram\.me)\//i, "");
	text = text.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, "");
	if (text.startsWith("@")) text = text.slice(1);
	if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(text)) {
		throw errorWithCode(
			"invalid_channel",
			"Use a public Telegram channel username such as @DRDNetwork.",
		);
	}
	return `@${text}`;
}

export function telegramChannelUrl(username) {
	const normalized = normalizeRequiredChannel(username);
	return `https://t.me/${normalized.slice(1)}`;
}

export function isTelegramMember(member) {
	const status = String(member?.status || "").toLowerCase();
	if (MEMBER_STATUSES.has(status)) return true;
	if (status === "restricted") return Boolean(member?.is_member);
	return false;
}

function uniqueChannels(channels) {
	const seen = new Set();
	const result = [];
	for (const item of channels) {
		let username;
		try {
			username = normalizeRequiredChannel(item.username ?? item);
		} catch {
			continue;
		}
		const key = channelKey(username);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push({
			username,
			immutable: Boolean(item.immutable),
		});
	}
	return result;
}

function safeErrorMessage(error) {
	return String(error?.message || error || "verification_failed").slice(0, 160);
}

/** Required Telegram membership policy and owner management service. */
export class RequiredMembershipService {
	constructor(repository, telegram, audit = null) {
		this.repository = repository;
		this.telegram = telegram;
		this.audit = audit;
	}

	async channels() {
		const extra = await this.repository.listExtra();
		const mandatory = REQUIRED_MEMBERSHIP_MANDATORY_CHANNELS.map((item) => ({ ...item }));
		const extras = extra.map((username) => ({ username, immutable: false }));
		return uniqueChannels([...mandatory, ...extras]);
	}

	async snapshot() {
		const channels = await this.channels();
		return {
			channels,
			mandatory: channels.filter((item) => item.immutable),
			extra: channels.filter((item) => !item.immutable),
			maxExtra: REQUIRED_MEMBERSHIP_MAX_EXTRA_CHANNELS,
		};
	}

	async checkUser(userId) {
		const numericUserId = Number(userId);
		if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) {
			throw errorWithCode("invalid_user_id", "Invalid Telegram user ID.");
		}
		const channels = await this.channels();
		const results = await Promise.all(
			channels.map(async (channel) => {
				try {
					const member = await this.telegram.getChatMember(channel.username, numericUserId);
					return {
						...channel,
						status: String(member?.status || "unknown"),
						member: isTelegramMember(member),
						unavailable: false,
					};
				} catch (error) {
					return {
						...channel,
						status: "unavailable",
						member: false,
						unavailable: true,
						error: safeErrorMessage(error),
					};
				}
			}),
		);
		return {
			ok: results.every((item) => item.member),
			channels: results,
			missing: results.filter((item) => !item.member && !item.unavailable),
			unavailable: results.filter((item) => item.unavailable),
		};
	}

	async add(rawChannel, actor) {
		assertOwner(actor);
		const requested = normalizeRequiredChannel(rawChannel);
		const mandatoryKeys = new Set(
			REQUIRED_MEMBERSHIP_MANDATORY_CHANNELS.map((item) => channelKey(item.username)),
		);
		if (mandatoryKeys.has(channelKey(requested))) {
			throw errorWithCode("channel_immutable", "Mandatory channels are immutable.");
		}

		const current = await this.repository.listExtra();
		if (current.some((item) => channelKey(item) === channelKey(requested))) {
			return { changed: false, username: current.find((item) => channelKey(item) === channelKey(requested)) };
		}
		if (current.length >= REQUIRED_MEMBERSHIP_MAX_EXTRA_CHANNELS) {
			throw errorWithCode("channel_limit", "Maximum extra required channels reached.");
		}

		let chat;
		try {
			chat = await this.telegram.getChat(requested);
		} catch (error) {
			throw errorWithCode("channel_unavailable", safeErrorMessage(error));
		}
		if (!ALLOWED_CHAT_TYPES.has(String(chat?.type || ""))) {
			throw errorWithCode("invalid_channel_type", "Only channels and supergroups are supported.");
		}
		if (!chat?.username) {
			throw errorWithCode("public_channel_required", "A public Telegram username is required.");
		}
		const canonical = normalizeRequiredChannel(`@${chat.username}`);
		if (mandatoryKeys.has(channelKey(canonical))) {
			throw errorWithCode("channel_immutable", "Mandatory channels are immutable.");
		}

		let bot;
		let botMembership;
		try {
			bot = await this.telegram.getMe();
			botMembership = await this.telegram.getChatMember(canonical, Number(bot?.id));
		} catch (error) {
			throw errorWithCode("channel_verification_failed", safeErrorMessage(error));
		}
		if (!["creator", "administrator"].includes(String(botMembership?.status || ""))) {
			throw errorWithCode(
				"bot_admin_required",
				"The bot must be an administrator in every required channel.",
			);
		}

		const next = uniqueChannels([
			...current.map((username) => ({ username, immutable: false })),
			{ username: canonical, immutable: false },
		]).map((item) => item.username);
		await this.repository.replaceExtra(next);
		await this.audit?.add?.(actorId(actor), "required_membership.channel_added", {
			channel: canonical,
		});
		return { changed: true, username: canonical };
	}

	async remove(rawChannel, actor) {
		assertOwner(actor);
		const requested = normalizeRequiredChannel(rawChannel);
		const mandatoryKeys = new Set(
			REQUIRED_MEMBERSHIP_MANDATORY_CHANNELS.map((item) => channelKey(item.username)),
		);
		if (mandatoryKeys.has(channelKey(requested))) {
			throw errorWithCode("channel_immutable", "Mandatory channels cannot be removed.");
		}

		const current = await this.repository.listExtra();
		const next = current.filter((item) => channelKey(item) !== channelKey(requested));
		if (next.length === current.length) {
			throw errorWithCode("channel_not_found", "Required channel not found.");
		}
		await this.repository.replaceExtra(next);
		await this.audit?.add?.(actorId(actor), "required_membership.channel_removed", {
			channel: requested,
		});
		return { changed: true, username: requested };
	}
}
