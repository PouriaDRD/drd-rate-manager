import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	TELEGRAM_API_MANAGEMENT,
	telegram_apiMethods,
} from "../src/controllers/telegram/telegram-api.methods.js";

function message() {
	return { chat: { id: 10 }, message_id: 20 };
}
function admin(role = "owner") {
	return { role, userId: role === "owner" ? "1" : "2" };
}
function token(id, overrides = {}) {
	return {
		id,
		name: `Token ${id}`,
		type: id % 2 ? "market" : "core",
		prefix: id % 2 ? `drd_mkt_${id}` : `drd_core_${id}`,
		enabled: true,
		expiresAt: 0,
		lastUsedAt: 0,
		usageCount: id,
		revokedAt: 0,
		createdAt: 1000,
		...overrides,
	};
}
function harness({
	role = "owner",
	tokens = [token(1), token(2)],
	mode = "public",
	language = "en",
} = {}) {
	const edits = [];
	const sends = [];
	const calls = [];
	const input = { set: [], clear: [] };
	const snapshot = {
		marketMode: mode,
		tokens,
		stats: {
			total: tokens.length,
			active: tokens.filter((x) => x.enabled && !x.revokedAt).length,
			market: tokens.filter((x) => x.type === "market").length,
			core: tokens.filter((x) => x.type === "core").length,
			revoked: tokens.filter((x) => x.revokedAt).length,
		},
	};
	const ctx = {
		s: {
			config: { timezone: "Asia/Tehran" },
			apiManagement: {
				async snapshot(actorValue) {
					calls.push(["snapshot", actorValue]);
					return snapshot;
				},
				async setMarketMode(value, actorValue) {
					calls.push(["mode", value, actorValue]);
					snapshot.marketMode = value;
					return value;
				},
				async setEnabled(id, enabled, actorValue) {
					calls.push(["enabled", String(id), enabled, actorValue]);
					return token(Number(id), { enabled });
				},
				async revoke(id, actorValue) {
					calls.push(["revoke", String(id), actorValue]);
					return token(Number(id), { enabled: false, revokedAt: 123 });
				},
				async rotate(id, _input, actorValue) {
					calls.push(["rotate", String(id), actorValue]);
					return {
						token: "drd_mkt_ONE_TIME",
						record: token(9, { name: "Rotated", type: "market" }),
						replacedTokenId: Number(id),
					};
				},
				async create(payload, actorValue) {
					calls.push(["create", payload, actorValue]);
					return {
						token: "drd_core_ONE_TIME",
						record: token(10, { name: payload.name, type: payload.type }),
					};
				},
			},
			adminInput: {
				async set(...args) { input.set.push(args); },
				async clear(...args) { input.clear.push(args); },
			},
			telegram: {
				async editMessage(chatId, messageId, text, keyboard) {
					edits.push({ chatId, messageId, text, keyboard });
					return { ok: true };
				},
				async sendMessage(chatId, text, keyboard) {
					sends.push({ chatId, text, keyboard });
					return { ok: true };
				},
			},
		},
		_tgLanguage() { return language; },
		_tg(key) { return key; },
		_adminActor(value, fallback = null) {
			return { type: "telegram", role: value?.role || "admin", id: value?.userId || fallback };
		},
	};
	Object.assign(ctx, telegram_apiMethods);
	return { ctx, edits, sends, calls, input, role: admin(role) };
}

test("Telegram API management exposes bounded page size and expiry presets", () => {
	assert.equal(TELEGRAM_API_MANAGEMENT.pageSize, 6);
	assert.deepEqual(TELEGRAM_API_MANAGEMENT.expiryDays, [0, 7, 30, 90, 365]);
	assert.equal(TELEGRAM_API_MANAGEMENT.clampPage(99, 7), 1);
	assert.equal(TELEGRAM_API_MANAGEMENT.clampPage(-2, 7), 0);
});

test("owner home uses shared snapshot and shows isolated Market/Core stats", async () => {
	const h = harness();
	await h.ctx._showApiManagement(message(), h.role);
	assert.equal(h.calls[0][0], "snapshot");
	assert.equal(h.calls[0][1].role, "owner");
	assert.match(h.edits[0].text, /API Management/);
	assert.match(h.edits[0].text, /Market: <b>1<\/b> · Core: <b>1<\/b>/);
	assert.doesNotMatch(h.edits[0].text, /ONE_TIME/);
});

test("regular admin cannot open API management and service is never called", async () => {
	const h = harness({ role: "admin" });
	await h.ctx._showApiManagement(message(), h.role);
	assert.equal(h.calls.length, 0);
	assert.match(h.edits[0].text, /Only the owner/);
});

test("token list is paginated and contains detail callbacks only", async () => {
	const tokens = Array.from({ length: 8 }, (_, i) => token(i + 1));
	const h = harness({ tokens });
	await h.ctx._showApiTokens(message(), h.role, 1);
	assert.match(h.edits[0].text, /Page <b>2\/2<\/b>/);
	const flat = h.edits[0].keyboard.inline_keyboard.flat();
	assert.ok(flat.some((b) => b.callback_data === "api:token:7"));
	assert.ok(flat.some((b) => b.callback_data === "api:tokens:0"));
});

test("active token detail offers toggle rotate revoke but revoked token does not", async () => {
	const h1 = harness({ tokens: [token(1)] });
	await h1.ctx._showApiTokenDetail(message(), h1.role, 1);
	const data1 = h1.edits[0].keyboard.inline_keyboard.flat().map((b) => b.callback_data);
	assert.ok(data1.includes("api:token:set:1:0"));
	assert.ok(data1.includes("api:token:rotate:confirm:1"));
	assert.ok(data1.includes("api:token:revoke:confirm:1"));

	const h2 = harness({ tokens: [token(1, { enabled: false, revokedAt: 5000 })] });
	await h2.ctx._showApiTokenDetail(message(), h2.role, 1);
	const data2 = h2.edits[0].keyboard.inline_keyboard.flat().map((b) => b.callback_data);
	assert.equal(data2.some((x) => /set|rotate|revoke/.test(x)), false);
});

test("market mode mutation uses shared owner actor", async () => {
	const h = harness();
	await h.ctx._setApiMarketMode(message(), h.role, "private");
	const call = h.calls.find((x) => x[0] === "mode");
	assert.equal(call[1], "private");
	assert.equal(call[2].type, "telegram");
	assert.equal(call[2].role, "owner");
});

test("token enable and revoke mutations use shared management service", async () => {
	const h = harness();
	await h.ctx._setApiTokenEnabled(message(), h.role, 1, false);
	assert.ok(h.calls.some((x) => x[0] === "enabled" && x[1] === "1" && x[2] === false));

	const h2 = harness();
	await h2.ctx._executeApiTokenRevoke(message(), h2.role, 1);
	assert.ok(h2.calls.some((x) => x[0] === "revoke" && x[1] === "1"));
});

test("rotate uses shared service and displays one-time secret without persistence", async () => {
	const h = harness();
	await h.ctx._executeApiTokenRotate(message(), h.role, 1);
	assert.ok(h.calls.some((x) => x[0] === "rotate"));
	assert.match(h.edits.at(-1).text, /drd_mkt_ONE_TIME/);
	assert.match(h.edits.at(-1).text, /ONE-TIME SECRET/);
	assert.ok(
		h.edits.at(-1).keyboard.inline_keyboard.flat().some(
			(b) => b.callback_data === "api:secret:hide:9",
		),
	);
});

test("create flow stores only type and expiry in existing admin input state", async () => {
	const h = harness();
	const before = Date.now();
	await h.ctx._beginApiTokenNameInput(message(), h.role, { id: 1 }, "core", 7);
	const [userId, action, payload] = h.input.set[0];
	assert.equal(userId, 1);
	assert.equal(action, "api_token_name");
	assert.equal(payload.type, "core");
	assert.ok(payload.expiresAt >= before + 7 * 86_400_000);
	assert.equal(Object.hasOwn(payload, "token"), false);
});

test("name input creates token as Telegram owner, clears state and sends one-time secret", async () => {
	const h = harness();
	await h.ctx._handleApiTokenNameInput(
		{ chat: { id: 10 }, from: { id: 1 }, text: "CLI client" },
		h.role,
		{ payload: { type: "core", expiresAt: 0 } },
	);
	const create = h.calls.find((x) => x[0] === "create");
	assert.equal(create[1].name, "CLI client");
	assert.equal(create[1].type, "core");
	assert.equal(create[2].type, "telegram");
	assert.deepEqual(h.input.clear, [[1]]);
	assert.match(h.sends[0].text, /drd_core_ONE_TIME/);
	assert.ok(
		h.sends[0].keyboard.inline_keyboard.flat().some(
			(b) => b.callback_data === "api:secret:hide:10",
		),
	);
});

test("failed token creation keeps input state for retry and never clears it", async () => {
	const h = harness();
	h.ctx.s.apiManagement.create = async () => {
		const error = new Error("bad");
		error.code = "invalid_token_name";
		throw error;
	};
	await h.ctx._handleApiTokenNameInput(
		{ chat: { id: 10 }, from: { id: 1 }, text: "" },
		h.role,
		{ payload: { type: "market", expiresAt: 0 } },
	);
	assert.equal(h.input.clear.length, 0);
	assert.match(h.sends[0].text, /1–80 characters/);
});

test("secret hide delegates back to safe token detail", async () => {
	const h = harness();
	let seen = null;
	h.ctx._showApiTokenDetail = async (_message, _admin, id) => {
		seen = id;
	};
	await h.ctx._hideApiSecret(message(), h.role, "9");
	assert.equal(seen, "9");
});

test("confirmation screens do not mutate until explicit execute callbacks", async () => {
	const h = harness();
	await h.ctx._showApiModeConfirmation(message(), h.role, "private");
	await h.ctx._confirmApiTokenRotate(message(), h.role, 1);
	await h.ctx._confirmApiTokenRevoke(message(), h.role, 1);
	assert.equal(h.calls.length, 0);
});

test("Telegram controller composes the API management methods module", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram.controller.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /telegram_apiMethods/);
	assert.match(source, /telegram-api\.methods\.js/);
});

test("core message flow routes pending API token name input and clears it on commands", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /input\?\.action === "api_token_name" && !command/);
	assert.match(source, /_handleApiTokenNameInput\(message, admin, input\)/);
	assert.match(source, /input\?\.action === "api_token_name" && command.*adminInput\.clear/s);
});

test("core callback routing keeps specific API actions before generic token detail", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url),
		"utf8",
	);
	const setIndex = source.indexOf('data.startsWith("api:token:set:")');
	const rotateIndex = source.indexOf('data.startsWith("api:token:rotate:execute:")');
	const genericIndex = source.indexOf('data.startsWith("api:token:")');
	assert.ok(setIndex >= 0);
	assert.ok(rotateIndex > setIndex);
	assert.ok(genericIndex > rotateIndex);
	assert.match(source, /api:create:expiry:/);
	assert.match(source, /api:secret:hide:/);
});

test("Settings exposes API Management only inside the owner branch", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-settings.methods.js", import.meta.url),
		"utf8",
	);
	const ownerIndex = source.indexOf('if (admin.role === "owner")');
	const apiIndex = source.indexOf('callback_data: "api:home"');
	assert.ok(ownerIndex >= 0);
	assert.ok(apiIndex > ownerIndex);
	assert.match(source.slice(ownerIndex, apiIndex), /keyboard\.push/);
});

test("Telegram API management source never writes raw secret to settings or admin input", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-api.methods.js", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /settings\.set\(.*token/i);
	assert.doesNotMatch(source, /adminInput\.set\([^)]*rawToken/s);
	assert.doesNotMatch(source, /localStorage|sessionStorage/);
	assert.match(source, /ONE-TIME SECRET/);
});

test("callback payload prefixes stay comfortably below Telegram 64-byte limit", () => {
	for (const value of [
		"api:mode:confirm:private",
		"api:mode:set:private",
		"api:create:expiry:market:365",
		"api:token:rotate:confirm:9223372036854775807",
		"api:token:revoke:execute:9223372036854775807",
		"api:secret:hide:9223372036854775807",
	]) {
		assert.ok(Buffer.byteLength(value, "utf8") <= 64, value);
	}
});

test("Phase 15.4 reuses schema 12 and application version 0.2.0", async () => {
	const source = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(source, /version:\s*"0\.2\.0"/);
	assert.match(source, /schemaVersion:\s*13/);
});
