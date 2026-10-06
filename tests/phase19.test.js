import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { telegram_loginHistoryMethods } from "../src/controllers/telegram/telegram-login-history.methods.js";
import { OperationalAlertService } from "../src/services/operational-alert.service.js";
import { WebLoginAlertService } from "../src/services/web-login-alert.service.js";

test("application identity is consistently version 0.2.0", async () => {
	const [packageJson, packageLock, appConfig, wrangler, envExample] =
		await Promise.all([
			readFile(new URL("../package.json", import.meta.url), "utf8"),
			readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
			readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
			readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
			readFile(new URL("../.env.example", import.meta.url), "utf8"),
		]);

	for (const source of [
		packageJson,
		packageLock,
		appConfig,
		wrangler,
		envExample,
	]) {
		assert.match(source, /0\.2\.0/);
	}
	assert.match(appConfig, /version:\s*"0\.2\.0"/);
	assert.match(wrangler, /"APP_VERSION":\s*"0\.2\.0"/);
	assert.match(wrangler, /DRD-Rate-Manager\/0\.2\.0/);
});

test("Web Admin login alert renders a compact device summary instead of a raw browser blob", async () => {
	const sent = [];
	const service = new WebLoginAlertService(
		{ ownerId: "1", timezone: "Asia/Tehran" },
		{
			async sendMessage(_chatId, text) {
				sent.push(text);
			},
		},
		{ telegramLanguage: "fa", async refresh() {} },
	);
	const request = new Request(
		"https://example.test/admin/api/v1/auth/login",
		{
			method: "POST",
			headers: {
				"CF-Connecting-IP": "203.0.113.10",
				"CF-Ray": "phase19-ray",
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36",
			},
		},
	);
	Object.defineProperty(request, "cf", {
		value: {
			city: "Rotterdam",
			region: "South Holland",
			country: "NL",
			timezone: "Europe/Amsterdam",
			asn: 64512,
		},
	});

	await service.notify(request, {
		username: "pouria-drd",
		result: "success",
		reason: "authenticated",
		sessionRef: "phase19-session",
		createdAt: 1_800_000_000_000,
	});

	assert.equal(sent.length, 1);
	assert.match(sent[0], /Web Admin/);
	assert.match(sent[0], /Windows/);
	assert.match(sent[0], /Chrome 154/);
	assert.match(sent[0], /Rotterdam/);
	assert.match(sent[0], /NL/);
	assert.match(sent[0], /phase19-session/);
	assert.match(sent[0], /phase19-ray/);
	assert.doesNotMatch(sent[0], /Mozilla\/5\.0/);
});

test("operational alert names affected providers and hides raw reason codes", async () => {
	const sent = [];
	let state = {
		active: false,
		fingerprint: null,
		severity: null,
		reasons: [],
		firstSentAt: 0,
		lastSentAt: 0,
		recoveredAt: 0,
	};
	const service = new OperationalAlertService(
		{ ownerId: "1" },
		{
			async sendMessage(_chatId, text) {
				sent.push(text);
			},
		},
		{ telegramLanguage: "fa" },
		{
			async get() {
				return { ...state };
			},
			async set(next) {
				state = { ...next };
			},
		},
	);

	await service.evaluate({
		health: {
			status: "degraded",
			warnings: ["source_failures", "provider_circuit_open"],
		},
		sources: {
			healthScore: 58,
			openCircuits: 1,
			healthy: 3,
			failed: 2,
			items: [
				{
					name: "wallex",
					label: "Wallex",
					enabled: true,
					healthy: false,
					status: 403,
					message: "Forbidden",
					circuitState: "open",
				},
				{
					name: "tabdeal",
					label: "Tabdeal",
					enabled: true,
					healthy: true,
					status: 200,
					circuitState: "closed",
				},
			],
		},
		cache: { expired: false, lastError: null },
	});

	assert.equal(sent.length, 1);
	assert.match(sent[0], /Wallex/);
	assert.match(sent[0], /403/);
	assert.match(sent[0], /58\/100/);
	assert.doesNotMatch(sent[0], /provider_circuit_open/);
	assert.doesNotMatch(sent[0], /source_failures/);
});

test("Telegram login history keeps each event compact", async () => {
	const edits = [];
	const context = {
		s: {
			config: { timezone: "Asia/Tehran" },
			loginHistory: {
				async stats() {
					return { total: 1, success: 1, failure: 0, locked: 0 };
				},
				async list() {
					return [
						{
							username: "pouria-drd",
							result: "success",
							reason: "authenticated",
							ipAddress: "203.0.113.10",
							userAgent:
								"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154.0.0.0 Safari/537.36",
							city: "Rotterdam",
							region: "South Holland",
							country: "NL",
							cfRay: "must-not-render-in-list",
							asn: 64512,
							sessionRef: "must-not-render-in-list",
							createdAt: 1_800_000_000_000,
						},
					];
				},
			},
			telegram: {
				async editMessage(...args) {
					edits.push(args);
				},
			},
		},
		_tgLanguage() {
			return "fa";
		},
		_tg() {
			return "settings";
		},
		_showLoginHistoryOwnerRequired:
			telegram_loginHistoryMethods._showLoginHistoryOwnerRequired,
	};

	await telegram_loginHistoryMethods._showLoginHistory.call(
		context,
		{ chat: { id: 1 }, message_id: 2 },
		{ role: "owner" },
	);

	const text = edits[0][2];
	assert.match(text, /pouria-drd/);
	assert.match(text, /Windows/);
	assert.match(text, /Chrome 154/);
	assert.match(text, /Rotterdam/);
	assert.match(text, /NL/);
	assert.match(text, /203\.0\.113\.10/);
	assert.doesNotMatch(text, /must-not-render-in-list/);
	assert.doesNotMatch(text, /Mozilla\/5\.0/);
});

test("Sources priority renderer targets the registered USDT priority element", async () => {
	const app = await readFile(
		new URL("../public/admin/assets/app.js", import.meta.url),
		"utf8",
	);
	assert.match(app, /els\.usdtPriorityList\.replaceChildren\(\)/);
	assert.doesNotMatch(app, /els\.priorityList/);
});

test("Web Admin static shell contains only the current application version", async () => {
	const html = await readFile(
		new URL("../public/admin/index.html", import.meta.url),
		"utf8",
	);
	const forbiddenLegacyVersion = ["0", "13", "0"].join(".");
	assert.match(html, /v0\.2\.0/);
	assert.ok(!html.includes(`v${forbiddenLegacyVersion}`));
});

test("version tool handles HTML and escaped regex version guards", async () => {
	const script = await readFile(
		new URL("../scripts/set-app-version.mjs", import.meta.url),
		"utf8",
	);
	assert.match(script, /"\.html"/);
	assert.match(script, /escapedCurrent/);
	assert.match(script, /replaceAll\("\.", "\\\\\."\)/);
});


test("Web Admin starts behind a neutral session gate instead of flashing login", async () => {
	const [html, app] = await Promise.all([
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
	]);

	assert.ok(html.includes('id="boot-screen" class="auth-screen"'));
	assert.ok(
		html.includes(
			'id="auth-screen" class="auth-screen" aria-label="Authentication" hidden',
		),
	);
	assert.ok(html.includes('id="app-shell" class="app-shell" hidden'));
	assert.ok(
		app.includes("async function restoreSession() {\n  showBoot();"),
	);
	assert.ok(
		app.includes(
			"if (error instanceof ApiError && error.status === 401) {",
		),
	);
	assert.ok(
		app.includes(
			'showBootError(error?.message || t(state.language, "sessionRestoreFailed"));',
		),
	);
});

test("Web Admin preserves the last valid active view across reloads", async () => {
	const app = await readFile(
		new URL("../public/admin/assets/app.js", import.meta.url),
		"utf8",
	);

	assert.ok(app.includes('const VIEW_KEY = "drd-admin-view";'));
	assert.ok(
		app.includes(
			'const initialActiveView = VIEWS[storedActiveView] ? storedActiveView : "dashboard";',
		),
	);
	assert.ok(app.includes("activeView: initialActiveView"));
	assert.ok(app.includes("writePreference(VIEW_KEY, view);"));
});
