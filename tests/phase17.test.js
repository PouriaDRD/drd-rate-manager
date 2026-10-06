import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	telegram_membershipMethods,
} from "../src/controllers/telegram/telegram-membership.methods.js";
import {
	REQUIRED_MEMBERSHIP_MANDATORY_CHANNELS,
	RequiredMembershipService,
	isTelegramMember,
	normalizeRequiredChannel,
} from "../src/services/required-membership.service.js";

class MemoryMembershipRepository {
	constructor(extra = []) {
		this.extra = [...extra];
		this.writes = [];
	}
	async listExtra() {
		return [...this.extra];
	}
	async replaceExtra(channels) {
		this.extra = [...channels];
		this.writes.push([...channels]);
		return [...channels];
	}
}

function serviceHarness({ extra = [], memberFor = null, chat = null, botMember = null } = {}) {
	const repository = new MemoryMembershipRepository(extra);
	const calls = { members: [], getChat: [], getMe: 0, audit: [] };
	const telegram = {
		async getChatMember(channel, userId) {
			calls.members.push({ channel, userId });
			if (memberFor) return memberFor(channel, userId);
			return botMember || { status: "member" };
		},
		async getChat(channel) {
			calls.getChat.push(channel);
			return chat || { type: "channel", username: String(channel).replace(/^@/, "") };
		},
		async getMe() {
			calls.getMe += 1;
			return { id: 999 };
		},
	};
	const audit = {
		async add(userId, action, data) {
			calls.audit.push({ userId, action, data });
		},
	};
	return {
		service: new RequiredMembershipService(repository, telegram, audit),
		repository,
		calls,
	};
}

function telegramContext({ language = "fa", requiredMembership = null } = {}) {
	const sent = [];
	const edited = [];
	const inputs = [];
	const cleared = [];
	const context = {
		...telegram_membershipMethods,
		s: {
			requiredMembership: requiredMembership || {
				async checkUser() {
					return { ok: true, channels: [], missing: [], unavailable: [] };
				},
				async snapshot() {
					return {
						channels: REQUIRED_MEMBERSHIP_MANDATORY_CHANNELS.map((item) => ({ ...item })),
						mandatory: REQUIRED_MEMBERSHIP_MANDATORY_CHANNELS.map((item) => ({ ...item })),
						extra: [],
						maxExtra: 10,
					};
				},
			},
			telegram: {
				async sendMessage(chatId, text, replyMarkup) {
					sent.push({ chatId, text, replyMarkup });
				},
				async editMessage(chatId, messageId, text, replyMarkup) {
					edited.push({ chatId, messageId, text, replyMarkup });
				},
			},
			adminInput: {
				async set(userId, action) {
					inputs.push({ userId, action });
				},
				async clear(userId) {
					cleared.push(userId);
				},
			},
		},
		_tgLanguage() {
			return language;
		},
		_tg(key) {
			return key;
		},
		async _showMenu(message, admin) {
			edited.push({ menu: true, message, admin });
		},
	};
	return { context, sent, edited, inputs, cleared };
}

const message = {
	chat: { id: 100 },
	message_id: 200,
	from: { id: 300 },
};

test("Phase 17 has exactly two permanent DRD membership channels", () => {
	assert.deepEqual(REQUIRED_MEMBERSHIP_MANDATORY_CHANNELS, [
		{ username: "@DRDNetwork", immutable: true },
		{ username: "@DRDrate", immutable: true },
	]);
});

test("required channel normalization accepts public usernames and t.me links", () => {
	assert.equal(normalizeRequiredChannel("@Example_Channel"), "@Example_Channel");
	assert.equal(normalizeRequiredChannel("https://t.me/Example_Channel"), "@Example_Channel");
	assert.equal(normalizeRequiredChannel("t.me/Example_Channel/"), "@Example_Channel");
	assert.throws(() => normalizeRequiredChannel("https://t.me/+privateInvite"), /public Telegram channel/i);
});

test("Telegram member classification accepts creator admin member and active restricted only", () => {
	for (const status of ["creator", "administrator", "member"]) {
		assert.equal(isTelegramMember({ status }), true);
	}
	assert.equal(isTelegramMember({ status: "restricted", is_member: true }), true);
	assert.equal(isTelegramMember({ status: "restricted", is_member: false }), false);
	assert.equal(isTelegramMember({ status: "left" }), false);
	assert.equal(isTelegramMember({ status: "kicked" }), false);
});

test("snapshot always prepends mandatory channels and deduplicates stored extras", async () => {
	const { service } = serviceHarness({
		extra: ["@ExtraOne", "@drdnetwork", "@ExtraOne"],
	});
	const snapshot = await service.snapshot();
	assert.deepEqual(snapshot.channels.map((item) => item.username), [
		"@DRDNetwork",
		"@DRDrate",
		"@ExtraOne",
	]);
	assert.equal(snapshot.mandatory.length, 2);
	assert.equal(snapshot.extra.length, 1);
});

test("membership check requires every channel and preserves per-channel status", async () => {
	const { service } = serviceHarness({
		extra: ["@ExtraOne"],
		memberFor(channel) {
			if (channel === "@DRDNetwork") return { status: "administrator" };
			if (channel === "@DRDrate") return { status: "restricted", is_member: true };
			return { status: "left" };
		},
	});
	const result = await service.checkUser(123);
	assert.equal(result.ok, false);
	assert.deepEqual(result.missing.map((item) => item.username), ["@ExtraOne"]);
	assert.equal(result.unavailable.length, 0);
});

test("Telegram verification errors fail closed instead of granting access", async () => {
	const { service } = serviceHarness({
		memberFor(channel) {
			if (channel === "@DRDrate") throw new Error("bot is not administrator");
			return { status: "member" };
		},
	});
	const result = await service.checkUser(123);
	assert.equal(result.ok, false);
	assert.equal(result.unavailable.length, 1);
	assert.equal(result.unavailable[0].username, "@DRDrate");
});

test("owner can add a public extra channel only after bot-admin verification", async () => {
	const { service, repository, calls } = serviceHarness({
		chat: { type: "channel", username: "ExtraChannel" },
		botMember: { status: "administrator" },
	});
	const result = await service.add("https://t.me/ExtraChannel", {
		role: "owner",
		id: "42",
	});
	assert.deepEqual(result, { changed: true, username: "@ExtraChannel" });
	assert.deepEqual(repository.extra, ["@ExtraChannel"]);
	assert.equal(calls.getMe, 1);
	assert.deepEqual(calls.audit, [
		{
			userId: "42",
			action: "required_membership.channel_added",
			data: { channel: "@ExtraChannel" },
		},
	]);
});

test("required channel management rejects non-owner mandatory edits and non-admin bot setup", async () => {
	const nonOwner = serviceHarness().service;
	await assert.rejects(
		() => nonOwner.add("@ExtraChannel", { role: "admin", id: "1" }),
		(error) => error.code === "owner_required",
	);
	await assert.rejects(
		() => nonOwner.remove("@DRDNetwork", { role: "owner", id: "1" }),
		(error) => error.code === "channel_immutable",
	);

	const brokenBot = serviceHarness({ botMember: { status: "member" } }).service;
	await assert.rejects(
		() => brokenBot.add("@ExtraChannel", { role: "owner", id: "1" }),
		(error) => error.code === "bot_admin_required",
	);
});

test("owner removal persists extras and writes a bounded audit event", async () => {
	const { service, repository, calls } = serviceHarness({ extra: ["@ExtraOne", "@ExtraTwo"] });
	const result = await service.remove("@ExtraOne", { role: "owner", id: "42" });
	assert.deepEqual(result, { changed: true, username: "@ExtraOne" });
	assert.deepEqual(repository.extra, ["@ExtraTwo"]);
	assert.equal(calls.audit[0].action, "required_membership.channel_removed");
});

test("owner bypass prevents administrative lockout without performing membership API calls", async () => {
	let checks = 0;
	const { context } = telegramContext({
		requiredMembership: {
			async checkUser() {
				checks += 1;
				return { ok: false };
			},
		},
	});
	assert.equal(
		await context._enforceRequiredMembership(message, { role: "owner" }, 300),
		true,
	);
	assert.equal(checks, 0);
});

test("non-owner gate renders join buttons and a deterministic membership recheck", async () => {
	const { context, sent } = telegramContext({
		requiredMembership: {
			async checkUser() {
				return {
					ok: false,
					channels: [
						{ username: "@DRDNetwork", member: false, unavailable: false },
						{ username: "@DRDrate", member: true, unavailable: false },
					],
					missing: [{ username: "@DRDNetwork" }],
					unavailable: [],
				};
			},
		},
	});
	assert.equal(
		await context._enforceRequiredMembership(message, { role: "admin" }, 300),
		false,
	);
	assert.equal(sent.length, 1);
	assert.match(sent[0].text, /DRDNetwork/);
	assert.equal(sent[0].replyMarkup.inline_keyboard[0][0].url, "https://t.me/DRDNetwork");
	assert.equal(
		sent[0].replyMarkup.inline_keyboard.at(-1)[0].callback_data,
		"membership:check",
	);
});

test("membership management UI keeps permanent channels locked and extras removable", async () => {
	const { context, edited } = telegramContext({
		requiredMembership: {
			async snapshot() {
				return {
					channels: [
						{ username: "@DRDNetwork", immutable: true },
						{ username: "@DRDrate", immutable: true },
						{ username: "@ExtraOne", immutable: false },
					],
					mandatory: [],
					extra: [{ username: "@ExtraOne", immutable: false }],
					maxExtra: 10,
				};
			},
		},
	});
	await context._showMembershipSettings(message, { role: "owner" });
	const keyboard = edited[0].replyMarkup.inline_keyboard.flat();
	assert.equal(
		keyboard.some((item) => String(item.callback_data || "").includes("remove:confirm:DRDNetwork")),
		false,
	);
	assert.equal(
		keyboard.some((item) => item.callback_data === "membership:remove:confirm:ExtraOne"),
		true,
	);
});

test("owner add-channel input uses existing admin input state and clears only after success", async () => {
	let added = 0;
	const { context, inputs, cleared, sent } = telegramContext({
		requiredMembership: {
			async add(value, actor) {
				added += 1;
				assert.equal(value, "@ExtraOne");
				assert.equal(actor.role, "owner");
				return { changed: true, username: "@ExtraOne" };
			},
		},
	});
	await context._beginRequiredChannelAdd(message, { role: "owner" }, { id: 300 });
	assert.deepEqual(inputs, [{ userId: 300, action: "required_channel_add" }]);
	await context._handleRequiredChannelInput(
		{ ...message, text: "@ExtraOne" },
		{ role: "owner", userId: "300" },
	);
	assert.equal(added, 1);
	assert.deepEqual(cleared, [300]);
	assert.match(sent.at(-1).text, /ExtraOne/);
});

test("Telegram controller and core route membership before protected admin work", async () => {
	const [controller, core, settings] = await Promise.all([
		readFile(new URL("../src/controllers/telegram.controller.js", import.meta.url), "utf8"),
		readFile(new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url), "utf8"),
		readFile(new URL("../src/controllers/telegram/telegram-settings.methods.js", import.meta.url), "utf8"),
	]);
	assert.match(controller, /telegram_membershipMethods/);
	assert.match(core, /_enforceRequiredMembership\(message, admin, user\.id/);
	assert.match(core, /data === "membership:check"/);
	assert.match(core, /input\?\.action === "required_channel_add"/);
	assert.match(settings, /callback_data: "membership:home"/);
	assert.match(settings, /admin\.role === "owner"/);
});

test("composition root and Telegram client expose one shared required-membership boundary", async () => {
	const [container, client] = await Promise.all([
		readFile(new URL("../src/app/container.js", import.meta.url), "utf8"),
		readFile(new URL("../src/clients/telegram.client.js", import.meta.url), "utf8"),
	]);
	assert.equal((container.match(/new RequiredMembershipRepository\(settings\)/g) || []).length, 1);
	assert.match(container, /settings,\s*requiredMembershipRepository,\s*settingsService/s);
	assert.equal(
		(container.match(/new RequiredMembershipService\(/g) || []).length,
		1,
	);
	assert.match(client, /getChatMember\(chatId, userId\)/);
	assert.match(client, /return this\.api\("getChatMember"/);
	assert.match(client, /getChat\(chatId\)/);
	assert.match(client, /getMe\(\)/);
});

test("Phase 17 reuses settings storage and keeps schema and application version stable", async () => {
	const [repository, service, app] = await Promise.all([
		readFile(new URL("../src/repositories/required-membership.repository.js", import.meta.url), "utf8"),
		readFile(new URL("../src/services/required-membership.service.js", import.meta.url), "utf8"),
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
	]);
	assert.doesNotMatch(repository, /CREATE TABLE|ALTER TABLE/);
	assert.doesNotMatch(service, /CREATE TABLE|ALTER TABLE/);
	assert.match(repository, /telegram_required_extra_channels_v1/);
	assert.match(app, /version:\s*"0\.2\.0"/);
	assert.match(app, /schemaVersion:\s*13/);
});
