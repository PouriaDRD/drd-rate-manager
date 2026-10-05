import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { telegram_systemMethods } from "../src/controllers/telegram/telegram-system.methods.js";

const message = { chat: { id: 1 }, message_id: 2, from: { id: 100000 }, text: "" };
const owner = { role: "owner", userId: "100000", user: { id: 100000 } };
const regularAdmin = { role: "admin", userId: "200000", user: { id: 200000 } };

function fixture({ language = "en" } = {}) {
	const edits = [];
	const sends = [];
	const calls = [];
	const data = {
		admins: [
			{
				userId: "100000",
				role: "owner",
				active: true,
				immutable: true,
				username: null,
				firstName: null,
				lastName: null,
				displayName: "Owner",
				addedBy: null,
				createdAt: 0,
				updatedAt: 0,
			},
			{
				userId: "200000",
				role: "admin",
				active: true,
				immutable: false,
				username: "test",
				firstName: "Test",
				lastName: "Admin",
				displayName: "Test Admin",
				addedBy: "telegram:100000",
				createdAt: 1000,
				updatedAt: 2000,
			},
		],
		stats: { total: 2, activeAdmins: 1, inactiveAdmins: 0, ownerConfigured: true },
		capabilities: { canManage: true },
	};
	const ctx = {
		s: {
			config: { timezone: "UTC", version: "0.13.0", displayName: "DRD Rate Manager" },
			adminManagement: {
				async snapshot(actor) { calls.push(["snapshot", actor]); return data; },
				async get(id, actor) {
					calls.push(["get", id, actor]);
					return data.admins.find((item) => item.userId === String(id)) || null;
				},
				async add(id, actor) {
					calls.push(["add", id, actor]);
					if (!/^\d{5,20}$/.test(String(id))) {
						throw { code: "invalid_telegram_id" };
					}
					return { userId: String(id) };
				},
				async setEnabled(id, enabled, actor) {
					calls.push(["setEnabled", id, enabled, actor]);
					return { userId: String(id), active: enabled };
				},
				async remove(id, actor) {
					calls.push(["remove", id, actor]);
					return { removed: true, userId: String(id) };
				},
			},
			adminInput: {
				async set(id, action) { calls.push(["inputSet", id, action]); },
				async clear(id) { calls.push(["inputClear", id]); },
			},
			telegram: {
				async editMessage(...args) { edits.push(args); return args; },
				async sendMessage(...args) { sends.push(args); return args; },
			},
		},
		_tgLanguage() { return language; },
		_tg(key) { return key; },
		...telegram_systemMethods,
	};
	return { ctx, edits, sends, calls, data };
}

test("Telegram admin list reads the shared management snapshot including owner", async () => {
	const { ctx, edits, calls } = fixture();
	await ctx._showAdmins(message, owner);
	assert.equal(calls[0][0], "snapshot");
	assert.deepEqual(calls[0][1], { type: "telegram", role: "owner", id: "100000" });
	assert.match(edits[0][2], /synchronized with Web Admin/i);
	const callbacks = edits[0][3].inline_keyboard.flat().map((button) => button.callback_data);
	assert.ok(callbacks.includes("admins:view:100000"));
	assert.ok(callbacks.includes("admins:view:200000"));
	assert.ok(callbacks.includes("admins:add"));
});

test("regular admins receive the same list but no management button", async () => {
	const { ctx, edits, data } = fixture();
	data.capabilities.canManage = false;
	await ctx._showAdmins(message, regularAdmin);
	const callbacks = edits[0][3].inline_keyboard.flat().map((button) => button.callback_data);
	assert.ok(!callbacks.includes("admins:add"));
});

test("owner detail is immutable and exposes no destructive actions", async () => {
	const { ctx, edits } = fixture();
	await ctx._showAdminDetail(message, owner, "100000");
	assert.match(edits[0][2], /protected/i);
	const callbacks = edits[0][3].inline_keyboard.flat().map((button) => button.callback_data);
	assert.deepEqual(callbacks, ["admins:home"]);
});

test("admin detail uses explicit setEnabled callbacks instead of legacy toggle", async () => {
	const { ctx, edits } = fixture();
	await ctx._showAdminDetail(message, owner, "200000");
	const callbacks = edits[0][3].inline_keyboard.flat().map((button) => button.callback_data);
	assert.ok(callbacks.includes("admins:set:200000:0"));
	assert.ok(callbacks.includes("admins:delete:confirm:200000"));
	assert.ok(!callbacks.some((value) => value.startsWith("admins:toggle:")));
});

test("Telegram setEnabled mutation routes through shared AdminManagementService", async () => {
	const { ctx, calls } = fixture();
	await ctx._setAdminEnabled(message, owner, "200000", false);
	assert.deepEqual(calls[0], [
		"setEnabled",
		"200000",
		false,
		{ type: "telegram", role: "owner", id: "100000" },
	]);
});

test("admin deletion requires a separate confirmation before shared-service removal", async () => {
	const { ctx, edits, calls } = fixture();
	await ctx._confirmAdminDelete(message, owner, "200000");
	assert.ok(!calls.some((call) => call[0] === "remove"));
	assert.equal(
		edits[0][3].inline_keyboard[0][0].callback_data,
		"admins:delete:execute:200000",
	);
	await ctx._executeAdminDelete(message, owner, "200000");
	assert.ok(calls.some((call) => call[0] === "remove" && call[1] === "200000"));
});

test("add-admin input delegates validation and audit responsibility to shared service", async () => {
	const { ctx, sends, calls } = fixture();
	await ctx._handleAddAdminInput(
		{ ...message, text: "300000", from: { id: 100000 } },
		owner,
	);
	assert.ok(calls.some((call) => call[0] === "add"));
	assert.ok(calls.some((call) => call[0] === "inputClear"));
	assert.match(sends[0][1], /added or re-enabled/i);
});

test("invalid Telegram ID gets localized feedback without repository-specific validation", async () => {
	const { ctx, sends } = fixture({ language: "fa" });
	await ctx._handleAddAdminInput(
		{ ...message, text: "bad", from: { id: 100000 } },
		owner,
	);
	assert.match(sends[0][1], /آیدی عددی Telegram معتبر نیست/);
});

test("core callback routing no longer mutates AdminRepository directly", async () => {
	const core = await readFile(
		new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url),
		"utf8",
	);
	const adminBlock = core.slice(
		core.indexOf('if (data === "admins:home"'),
		core.indexOf('if (data === "global:disable"'),
	);
	assert.match(adminBlock, /admins:set:/);
	assert.match(adminBlock, /admins:delete:confirm:/);
	assert.match(adminBlock, /admins:delete:execute:/);
	assert.doesNotMatch(adminBlock, /this\.s\.admins\.toggle/);
	assert.doesNotMatch(adminBlock, /this\.s\.admins\.remove/);
	assert.doesNotMatch(adminBlock, /this\.s\.admins\.add/);
});

test("Telegram system methods no longer duplicate admin audit writes", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-system.methods.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /adminManagement\.add/);
	assert.match(source, /adminManagement\.setEnabled/);
	assert.match(source, /adminManagement\.remove/);
	assert.doesNotMatch(source, /this\.s\.audit\.add/);
	assert.doesNotMatch(source, /normalizeDigits/);
});
