import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { telegram_loginHistoryMethods } from "../src/controllers/telegram/telegram-login-history.methods.js";
import { MarketSources, resolveGoldConsensus, resolveUsdtConsensus } from "../src/market/market-sources.js";
import {
	OperationalAlertService,
	operationalAlertCandidate,
} from "../src/services/operational-alert.service.js";
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


test("Phase 19.4 feature modules are deterministic app dependencies", async () => {
	const [html, app, apiManagement, loginHistory] = await Promise.all([
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/api-management.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/login-history.js", import.meta.url), "utf8"),
	]);

	assert.ok(app.includes('import { apiManagementView } from "./api-management.js";'));
	assert.ok(app.includes('import { loginHistoryView } from "./login-history.js";'));
	assert.ok(app.includes('await apiManagementView.load();'));
	assert.ok(app.includes('await loginHistoryView.load();'));
	assert.ok(app.includes('apiManagementView.reset();'));
	assert.ok(app.includes('loginHistoryView.reset();'));
	assert.equal(app.includes("window.DRDApiManagement?.load"), false);
	assert.equal(app.includes("window.DRDLoginHistory?.load"), false);
	assert.equal(
		html.includes('<script type="module" src="assets/api-management.js"></script>'),
		false,
	);
	assert.equal(
		html.includes('<script type="module" src="assets/login-history.js"></script>'),
		false,
	);
	assert.ok(apiManagement.includes("export const apiManagementView"));
	assert.ok(loginHistory.includes("export const loginHistoryView"));
});

test("Phase 19.4 feature views expose loading empty and visible error states", async () => {
	const [apiManagement, loginHistory] = await Promise.all([
		readFile(new URL("../public/admin/assets/api-management.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/login-history.js", import.meta.url), "utf8"),
	]);

	for (const source of [apiManagement, loginHistory]) {
		assert.ok(source.includes("function renderLoading()"));
		assert.ok(source.includes("function renderLoadError(error)"));
		assert.ok(source.includes("throw error;"));
		assert.equal(source.includes(".innerHTML"), false);
	}
	assert.ok(apiManagement.includes('tr("noTokens")'));
	assert.ok(loginHistory.includes('tr("noHistory")'));
});


test("Phase 19.5 uses documented Wallex and Exir response contracts", async () => {
	const statusWrites = [];
	const responseFor = (data) => ({
		ok: true,
		status: 200,
		async json() {
			return data;
		},
	});
	let response = responseFor({
		result: {
			symbols: {
				USDTTMN: {
					stats: { askPrice: "123456", lastPrice: "123000" },
				},
			},
		},
	});
	const sources = new MarketSources(
		{},
		{
			async fetch() {
				return response;
			},
			async sourceError() {
				return "error";
			},
		},
		{
			async save(name, result) {
				statusWrites.push([name, result]);
			},
		},
		{},
		null,
		null,
	);

	const wallex = await sources.checkWallex();
	assert.equal(wallex.success, true);
	assert.equal(wallex.price, 123456);

	response = responseFor({
		"usdt-irt": {
			asks: [["124000", "12"]],
			bids: [["123900", "10"]],
		},
	});
	const exir = await sources.checkExir();
	assert.equal(exir.success, true);
	assert.equal(exir.price, 123950);
	assert.equal(statusWrites.length, 0);
});

test("Phase 19.5 treats normal cache expiry as non-actionable alert noise", () => {
	assert.equal(
		operationalAlertCandidate({
			health: {
				status: "degraded",
				warnings: ["cache_expired", "sources_unverified"],
			},
		}),
		null,
	);
	const routeFailure = operationalAlertCandidate({
		health: {
			status: "degraded",
			warnings: ["source_failures"],
		},
	});
	assert.deepEqual(routeFailure?.reasons, ["source_failures"]);
});

test("Phase 19.5 source health is group-aware and cache lifecycle is informational", async () => {
	const [providerHealth, system] = await Promise.all([
		readFile(new URL("../src/services/provider-health.service.js", import.meta.url), "utf8"),
		readFile(new URL("../src/services/system-management.service.js", import.meta.url), "utf8"),
	]);
	assert.ok(providerHealth.includes("fleetScore"));
	assert.ok(providerHealth.includes("activeSource"));
	assert.ok(providerHealth.includes("providerGroup("));
	assert.ok(system.includes("unavailableGroups"));
	assert.ok(system.includes('notices.push("cache_expired")'));
	assert.equal(system.includes('warnings.push("cache_expired")'), false);
});


test("Phase 19.6A providers remain configured while Nobitex stays opt-in", async () => {
	const sourceSettings = await readFile(
		new URL("../src/services/source-settings.service.js", import.meta.url),
		"utf8",
	);
	assert.ok(sourceSettings.includes('bitpin: Object.freeze({ key: "source.bitpin.enabled"'));
	assert.ok(sourceSettings.includes('nobitex: Object.freeze({ key: "source.nobitex.enabled"'));
	assert.ok(sourceSettings.includes('label: "Bitpin", kind: "usdt", defaultEnabled: true'));
	assert.ok(sourceSettings.includes('label: "Nobitex", kind: "usdt", defaultEnabled: false'));
});

test("Phase 19.6A parses Bitpin and Nobitex public orderbooks independently", async () => {
	let current = {
		asks: [["267357", "1.2"]],
		bids: [["267348", "2.3"]],
	};
	const sources = new MarketSources(
		{},
		{
			async fetch() {
				return {
					ok: true,
					status: 200,
					async json() {
						return current;
					},
				};
			},
			async sourceError(response) {
				return `HTTP ${response.status}`;
			},
		},
		{ async save() {}, async saveMany() {} },
		{},
		null,
		null,
	);

	const bitpin = await sources.checkBitpin();
	assert.equal(bitpin.success, true);
	assert.equal(bitpin.price, 267352.5);

	current = {
		status: "ok",
		asks: [["268100", "10"]],
		bids: [["268000", "11"]],
	};
	const nobitex = await sources.checkNobitex();
	assert.equal(nobitex.success, true);
	assert.equal(nobitex.price, 268050);
});

test("Phase 19.6A source testing and UI labels cover both new USDT providers", async () => {
	const [controller, webApp, core] = await Promise.all([
		readFile(new URL("../src/controllers/web-admin-data.controller.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
		readFile(new URL("../src/utils/core.js", import.meta.url), "utf8"),
	]);
	assert.ok(controller.includes('case "bitpin":'));
	assert.ok(controller.includes('case "nobitex":'));
	assert.ok(webApp.includes('bitpin: "Bitpin"'));
	assert.ok(webApp.includes('nobitex: "Nobitex"'));
	assert.ok(core.includes('bitpin: "Bitpin"'));
	assert.ok(core.includes('nobitex: "Nobitex"'));
});


test("Phase 19.6B normalizes six live gold providers into Toman per gram 18K", async () => {
	const responses = new Map([
		["technogold", { succeed: true, results: { buy_price: 26772195, sell_price: 26439208 } }],
		["melligold", { message: "Success", data: { price_buy: 26606640, price_sell: 26606640 } }],
		["talasea", { price: 26680 }],
		["milli", { code: 0, data: { price18: 265400 } }],
		["gerami", { data: { pair: { price: 26749845, buy_price: 26749845, sell_price: 26549514 } } }],
	]);
	const statuses = { async save() {}, async saveMany() {} };
	const http = {
		async fetch(url) {
			const key =
				url.includes("technogold") ? "technogold" :
				url.includes("melligold") ? "melligold" :
				url.includes("talasea") ? "talasea" :
				url.includes("milli.gold") ? "milli" :
				url.includes("gerami") ? "gerami" :
				"wallgold";
			const body = key === "wallgold" ? { result: { price: 26650000 } } : responses.get(key);
			return { ok: true, status: 200, async json() { return body; } };
		},
		async sourceError(response) { return `HTTP ${response.status}`; },
	};
	const sources = new MarketSources({}, http, statuses);
	assert.equal((await sources.checkTalasea()).price, 26680000);
	assert.equal((await sources.checkMilli()).price, 26540000);
	assert.equal((await sources.checkMelliGold()).price, 26606640);
	assert.equal((await sources.checkGerami()).price, 26749845);
	assert.equal(Math.round((await sources.checkTechnoGold()).price), 26605702);
	assert.equal((await sources.checkWallGold()).price, 26650000);
});

test("Phase 19.6B gold consensus rejects a large outlier and keeps healthy contributors", () => {
	const result = resolveGoldConsensus({
		wallgold: { success: true, price: 26650000 },
		technogold: { success: true, price: 26610000 },
		melligold: { success: true, price: 26600000 },
		talasea: { success: true, price: 26680000 },
		milli: { success: true, price: 26540000 },
		gerami: { success: true, price: 99000000 },
	});
	assert.equal(result.success, true);
	assert.ok(result.price > 26500000 && result.price < 26800000);
	assert.ok(result.contributors.length >= 4);
	assert.deepEqual(result.rejected, ["gerami"]);
});

test("Phase 19.6B gold sources are first-class health and management providers", async () => {
	const [settings, statusRepo, web, telegram, app] = await Promise.all([
		readFile(new URL("../src/services/source-settings.service.js", import.meta.url), "utf8"),
		readFile(new URL("../src/repositories/source-status.repository.js", import.meta.url), "utf8"),
		readFile(new URL("../src/controllers/web-admin-data.controller.js", import.meta.url), "utf8"),
		readFile(new URL("../src/controllers/telegram/telegram-settings.methods.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
	]);
	for (const name of ["technogold", "melligold", "talasea", "milli", "gerami"]) {
		assert.ok(settings.includes(name));
		assert.ok(statusRepo.includes(name));
		assert.ok(web.includes(name));
		assert.ok(app.includes(name));
	}
	assert.ok(telegram.includes('item.kind === "gold"'));
});


test("Phase 19.6C parses OMPFinex and Ramzinex into normalized Toman reference prices", async () => {
	let body = {
		data: {
			USDTIRR: {
				asks: [{ price: "2679000" }, { price: "2680000" }],
				bids: [{ price: "2680600" }, { price: "2681000" }],
			},
		},
	};
	const sources = new MarketSources(
		{},
		{
			async fetch() {
				return { ok: true, status: 200, async json() { return body; } };
			},
			async sourceError(response) { return `HTTP ${response.status}`; },
		},
		{ async save() {}, async saveMany() {} },
	);

	const ompfinex = await sources.checkOmpfinex();
	assert.equal(ompfinex.success, true);
	assert.equal(ompfinex.price, 268030);

	body = {
		data: [{
			pair_id: 11,
			url_name: "tether-usdt",
			buy: "2685500",
			sell: "2685925",
		}],
	};
	const ramzinex = await sources.checkRamzinex();
	assert.equal(ramzinex.success, true);
	assert.equal(ramzinex.price, 268571.25);
});

test("Phase 19.6C USDT uses the same median and 3-percent outlier strategy as gold", () => {
	const result = resolveUsdtConsensus({
		wallex: { success: true, price: 268000 },
		tabdeal: { success: true, price: 268100 },
		exir: { success: true, price: 267900 },
		bitpin: { success: true, price: 268050 },
		nobitex: { success: false, price: null },
		ompfinex: { success: true, price: 268030 },
		ramzinex: { success: true, price: 900000 },
	});
	assert.equal(result.success, true);
	assert.equal(result.source, "usdt-consensus");
	assert.ok(result.price >= 268000 && result.price <= 268100);
	assert.deepEqual(result.rejected, ["ramzinex"]);
	assert.ok(result.contributors.includes("ompfinex"));
});

test("Phase 19.6C exposes seven USDT providers and consensus metadata across control planes", async () => {
	const [appConfig, settings, statuses, web, webApp, telegram, serializer] = await Promise.all([
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
		readFile(new URL("../src/services/source-settings.service.js", import.meta.url), "utf8"),
		readFile(new URL("../src/repositories/source-status.repository.js", import.meta.url), "utf8"),
		readFile(new URL("../src/controllers/web-admin-data.controller.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
		readFile(new URL("../src/controllers/telegram/telegram-settings.methods.js", import.meta.url), "utf8"),
		readFile(new URL("../src/api/serializers.js", import.meta.url), "utf8"),
	]);
	for (const name of ["ompfinex", "ramzinex"]) {
		assert.ok(appConfig.includes(name));
		assert.ok(settings.includes(name));
		assert.ok(statuses.includes(name));
		assert.ok(web.includes(name));
		assert.ok(webApp.includes(name));
	}
	assert.ok(settings.includes('usdt_strategy: "consensus"'));
	assert.ok(telegram.includes("اجماع قیمت تتر"));
	assert.ok(serializer.includes("contributors: snapshot.usdt?.contributors"));
	assert.ok(serializer.includes("rejected: snapshot.usdt?.rejected"));
});


test("Phase 19.6D keeps MelliGold opt-in after redirect-loop verification", async () => {
	const sourceSettings = await readFile(
		new URL("../src/services/source-settings.service.js", import.meta.url),
		"utf8",
	);
	assert.ok(
		sourceSettings.includes(
			'melligold: Object.freeze({ key: "source.melligold.enabled", label: "MelliGold", kind: "gold", defaultEnabled: false })',
		),
	);
});
