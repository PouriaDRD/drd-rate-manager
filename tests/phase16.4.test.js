import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	LOGIN_HISTORY_PAGE_SIZE,
	telegram_loginHistoryMethods,
} from "../src/controllers/telegram/telegram-login-history.methods.js";

function event(overrides = {}) {
	return {
		id: 1,
		userId: 1,
		username: "admin",
		result: "success",
		reason: "authenticated",
		ipAddress: "203.0.113.20",
		userAgent: "Phase16.4-Test",
		cfRay: "ray-164",
		country: "NL",
		region: "South Holland",
		city: "Rotterdam",
		timezone: "Europe/Amsterdam",
		asn: 64512,
		sessionRef: "abcdef0123456789",
		createdAt: 1_800_000_000_000,
		...overrides,
	};
}

function harness({ language = "fa", stats = null, rows = null } = {}) {
	const calls = { stats: 0, list: [], edits: [] };
	const resolvedStats = stats || { total: 9, success: 5, failure: 3, locked: 1 };
	const resolvedRows = rows || [event()];
	const context = {
		s: {
			config: { timezone: "Asia/Tehran" },
			loginHistory: {
				async stats() {
					calls.stats += 1;
					return { ...resolvedStats };
				},
				async list(options) {
					calls.list.push({ ...options });
					return resolvedRows.map((item) => ({ ...item }));
				},
			},
			telegram: {
				async editMessage(...args) {
					calls.edits.push(args);
					return { message_id: 99 };
				},
			},
		},
		_tgLanguage() {
			return language;
		},
		_tg(key) {
			return key === "settings" ? (language === "en" ? "Settings" : "تنظیمات") : key;
		},
		_showLoginHistoryOwnerRequired: telegram_loginHistoryMethods._showLoginHistoryOwnerRequired,
	};
	return { context, calls };
}

const message = { chat: { id: 123 }, message_id: 456 };
const owner = { role: "owner" };

test("Telegram login history uses the shared service with bounded default pagination", async () => {
	const { context, calls } = harness();
	await telegram_loginHistoryMethods._showLoginHistory.call(context, message, owner);
	assert.equal(calls.stats, 1);
	assert.deepEqual(calls.list, [
		{ limit: LOGIN_HISTORY_PAGE_SIZE, offset: 0, result: null },
	]);
	assert.equal(calls.edits.length, 1);
	assert.match(calls.edits[0][2], /امنیت ورود Web Admin/);
});

test("Telegram login history supports result filters and page offsets", async () => {
	const { context, calls } = harness({
		stats: { total: 20, success: 12, failure: 7, locked: 1 },
	});
	await telegram_loginHistoryMethods._showLoginHistory.call(context, message, owner, {
		result: "failure",
		page: 1,
	});
	assert.deepEqual(calls.list[0], {
		limit: LOGIN_HISTORY_PAGE_SIZE,
		offset: LOGIN_HISTORY_PAGE_SIZE,
		result: "failure",
	});
	assert.match(calls.edits[0][2], /صفحه <b>2\/2<\/b>/);
});

test("Telegram login history clamps invalid filters and out-of-range pages", async () => {
	const { context, calls } = harness({
		stats: { total: 5, success: 2, failure: 2, locked: 1 },
	});
	await telegram_loginHistoryMethods._showLoginHistory.call(context, message, owner, {
		result: "unknown",
		page: 99,
	});
	assert.deepEqual(calls.list[0], {
		limit: LOGIN_HISTORY_PAGE_SIZE,
		offset: LOGIN_HISTORY_PAGE_SIZE,
		result: null,
	});
});

test("Telegram login history is owner-only before reading security data", async () => {
	const { context, calls } = harness();
	await telegram_loginHistoryMethods._showLoginHistory.call(
		context,
		message,
		{ role: "admin" },
	);
	assert.equal(calls.stats, 0);
	assert.equal(calls.list.length, 0);
	assert.match(calls.edits[0][2], /Owner|مالک|Owner ربات|دسترسی Owner/);
});

test("Telegram login history follows the persisted Telegram language", async () => {
	const { context, calls } = harness({ language: "en" });
	await telegram_loginHistoryMethods._showLoginHistory.call(context, message, owner);
	const text = calls.edits[0][2];
	assert.match(text, /Web Admin Login Security/);
	assert.match(text, /Authenticated/);
	assert.match(text, /Page/);
});

test("Telegram login history escapes untrusted metadata and ignores credential-shaped fields", async () => {
	const { context, calls } = harness({
		rows: [
			event({
				username: "<b>evil</b>",
				userAgent: "<script>alert(1)</script>",
				city: "<i>city</i>",
				password: "must-not-leak",
				tokenHash: "must-not-leak",
				cookie: "must-not-leak",
			}),
		],
	});
	await telegram_loginHistoryMethods._showLoginHistory.call(context, message, owner);
	const text = calls.edits[0][2];
	assert.match(text, /&lt;b&gt;evil&lt;\/b&gt;/);
	assert.match(text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.equal(text.includes("must-not-leak"), false);
});

test("Telegram login history renders a deterministic empty state", async () => {
	const { context, calls } = harness({
		stats: { total: 0, success: 0, failure: 0, locked: 0 },
		rows: [],
	});
	await telegram_loginHistoryMethods._showLoginHistory.call(context, message, owner, {
		result: "locked",
	});
	assert.match(calls.edits[0][2], /رویدادی برای این فیلتر وجود ندارد/);
});

test("Telegram settings exposes Login Security only inside the owner branch", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-settings.methods.js", import.meta.url),
		"utf8",
	);
	const ownerBranch = source.slice(
		source.indexOf('if (admin.role === "owner")'),
		source.indexOf("\n\t}\n\tkeyboard.push", source.indexOf('if (admin.role === "owner")')) + 3,
	);
	assert.match(ownerBranch, /security:logins:all:0/);
	assert.match(ownerBranch, /Login Security/);
});

test("Telegram callback routing and controller composition include login history", async () => {
	const [core, controller] = await Promise.all([
		readFile(
			new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url),
			"utf8",
		),
		readFile(new URL("../src/controllers/telegram.controller.js", import.meta.url), "utf8"),
	]);
	assert.match(core, /security:logins:/);
	assert.match(core, /this\._showLoginHistory\(message, admin/);
	assert.match(controller, /telegram-login-history\.methods\.js/);
	assert.match(controller, /telegram_loginHistoryMethods/);
});

test("Phase 16.4 reuses persistent history and keeps schema and app version stable", async () => {
	const [moduleSource, appConfig] = await Promise.all([
		readFile(
			new URL(
				"../src/controllers/telegram/telegram-login-history.methods.js",
				import.meta.url,
			),
			"utf8",
		),
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
	]);
	assert.match(moduleSource, /this\.s\.loginHistory\.stats\(\)/);
	assert.match(moduleSource, /this\.s\.loginHistory\.list/);
	assert.doesNotMatch(moduleSource, /DB\.prepare|CREATE TABLE|ALTER TABLE/);
	assert.doesNotMatch(moduleSource, /password|csrf|authorization|cookie|token_hash/i);
	assert.match(appConfig, /version:\s*"0\.2\.1"/);
	assert.match(appConfig, /schemaVersion:\s*13/);
});
