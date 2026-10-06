import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ApiController } from "../src/controllers/api.controller.js";
import {
	ApiAccessService,
	CORE_API_PATHS,
	MARKET_API_MODE_KEY,
	MARKET_API_MODES,
	MARKET_API_PATHS,
	normalizeMarketApiMode,
} from "../src/services/api-access.service.js";

function settingsHarness(initial = {}) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		async get(key, fallback = null) {
			return values.has(key) ? values.get(key) : fallback;
		},
		async set(key, value) {
			values.set(key, String(value));
		},
	};
}

function tokenHarness(result = { ok: true, status: 200, reason: "authenticated" }) {
	const calls = [];
	return {
		calls,
		async authenticate(request, expectedType) {
			calls.push({ request, expectedType });
			return { ...result };
		},
	};
}

function json(response) {
	return response.json();
}

test("missing market mode defaults to public while invalid stored values fail closed to private", () => {
	assert.equal(normalizeMarketApiMode(null), "public");
	assert.equal(normalizeMarketApiMode(""), "public");
	assert.equal(normalizeMarketApiMode("PUBLIC"), "public");
	assert.equal(normalizeMarketApiMode("private"), "private");
	assert.equal(normalizeMarketApiMode("broken"), "private");
});

test("market endpoints are explicitly separated from core endpoints", () => {
	assert.deepEqual(MARKET_API_PATHS, [
		"/api/v1/market",
		"/api/v1/assets",
		"/api/v1/sources",
		"/api/v1/sources/usdt",
	]);
	assert.deepEqual(CORE_API_PATHS, [
		"/api/v1/automation",
		"/api/v1/system",
		"/api/v1/system/database",
	]);
});

test("public market mode bypasses token authentication entirely", async () => {
	const settings = settingsHarness({ [MARKET_API_MODE_KEY]: "public" });
	const tokens = tokenHarness({ ok: false, status: 401, reason: "invalid_token" });
	const access = new ApiAccessService(settings, tokens);

	for (const path of MARKET_API_PATHS) {
		const result = await access.authorize(
			new Request(`https://example.test${path}`),
			path,
		);
		assert.equal(result.ok, true);
		assert.equal(result.mode, MARKET_API_MODES.PUBLIC);
		assert.equal(result.anonymous, true);
	}
	assert.equal(tokens.calls.length, 0);
});

test("private market mode requires market token scope", async () => {
	const settings = settingsHarness({ [MARKET_API_MODE_KEY]: "private" });
	const tokens = tokenHarness({ ok: false, status: 401, reason: "missing_token" });
	const access = new ApiAccessService(settings, tokens);
	const result = await access.authorize(
		new Request("https://example.test/api/v1/market"),
		"/api/v1/market",
	);
	assert.equal(result.ok, false);
	assert.equal(result.requiredType, "market");
	assert.equal(result.mode, "private");
	assert.equal(tokens.calls.length, 1);
	assert.equal(tokens.calls[0].expectedType, "market");
});

test("core endpoints always require core scope regardless of market mode", async () => {
	for (const mode of ["public", "private"]) {
		const settings = settingsHarness({ [MARKET_API_MODE_KEY]: mode });
		const tokens = tokenHarness({ ok: false, status: 401, reason: "missing_token" });
		const access = new ApiAccessService(settings, tokens);
		const result = await access.authorize(
			new Request("https://example.test/api/v1/system"),
			"/api/v1/system",
		);
		assert.equal(result.ok, false);
		assert.equal(result.requiredType, "core");
		assert.equal(result.mode, "private");
		assert.equal(tokens.calls[0].expectedType, "core");
	}
});

test("market mode mutation validates exact public/private values", async () => {
	const settings = settingsHarness();
	const access = new ApiAccessService(settings, tokenHarness());
	assert.equal(await access.setMarketMode("PUBLIC"), "public");
	assert.equal(values(settings).get(MARKET_API_MODE_KEY), "public");
	assert.equal(await access.setMarketMode("private"), "private");
	await assert.rejects(() => access.setMarketMode("internal"), /public or private/i);
});

function values(settings) {
	return settings.values;
}

test("unrelated paths have no API token policy", async () => {
	const access = new ApiAccessService(settingsHarness(), tokenHarness());
	assert.equal(await access.authorize(new Request("https://example.test/docs"), "/docs"), null);
	assert.equal(await access.authorize(new Request("https://example.test/"), "/"), null);
});

test("API controller keeps root public without needing access policy service", async () => {
	const controller = new ApiController({
		config: { env: {}, version: "0.2.0", timezone: "Asia/Tehran" },
	});
	const response = await controller.route(
		new Request("https://example.test/"),
		new URL("https://example.test/"),
	);
	assert.equal(response.status, 200);
	assert.equal((await json(response)).success, true);
});

test("private market denial happens before market provider/cache work", async () => {
	let marketCalls = 0;
	const controller = new ApiController({
		apiAccess: {
			async authorize() {
				return {
					ok: false,
					status: 401,
					reason: "missing_token",
					requiredType: "market",
				};
			},
		},
		market: {
			async getSnapshot() {
				marketCalls += 1;
				return {};
			},
		},
	});
	const response = await controller.route(
		new Request("https://example.test/api/v1/market"),
		new URL("https://example.test/api/v1/market"),
	);
	assert.equal(response.status, 401);
	const payload = await json(response);
	assert.equal(payload.success, false);
	assert.equal(payload.error.code, "missing_token");
	assert.equal(payload.error.required_scope, "market");
	assert.equal(marketCalls, 0);
});

test("wrong API scope returns deterministic 403 without executing core endpoint", async () => {
	let downstreamCalls = 0;
	const controller = new ApiController({
		apiAccess: {
			async authorize() {
				return {
					ok: false,
					status: 403,
					reason: "wrong_scope",
					requiredType: "core",
				};
			},
		},
		settings: {
			async get() {
				downstreamCalls += 1;
				return "1";
			},
		},
		admins: { async stats() { downstreamCalls += 1; return {}; } },
		automation: { async getSettings() { downstreamCalls += 1; return {}; } },
	});
	const response = await controller.route(
		new Request("https://example.test/api/v1/system"),
		new URL("https://example.test/api/v1/system"),
	);
	assert.equal(response.status, 403);
	const payload = await json(response);
	assert.equal(payload.message, "Forbidden");
	assert.equal(payload.error.code, "wrong_scope");
	assert.equal(payload.error.required_scope, "core");
	assert.equal(downstreamCalls, 0);
});

test("authorized market request preserves existing response contract", async () => {
	const controller = new ApiController({
		apiAccess: {
			async authorize() {
				return { ok: true, status: 200, requiredType: "market", mode: "private" };
			},
		},
		config: { timezone: "Asia/Tehran" },
		market: {
			async getSnapshot() {
				return {
					createdAt: Date.now(),
					partial: false,
					errors: [],
					usdt: { price: 60000, source: "Tabdeal", fallbackLevel: 1 },
					crypto: [],
					metals: { gram18: null, mazaneh: null, gold: null, silver: null },
					quality: {
						publishable: true,
						coreAvailable: 2,
						coreRequired: 2,
						coreTotal: 3,
						completeness: 50,
						availableSections: ["usdt", "crypto"],
						missingSections: ["iran_gold", "global_metals"],
					},
					cache: {
						fromCache: false,
						staleFallback: false,
						fetchedAt: Date.now(),
						expiresAt: Date.now() + 30_000,
						ttlSeconds: 30,
						configuredTtlSeconds: 30,
						lastError: null,
					},
				};
			},
		},
	});
	const response = await controller.route(
		new Request("https://example.test/api/v1/market"),
		new URL("https://example.test/api/v1/market"),
	);
	assert.equal(response.status, 200);
	const payload = await json(response);
	assert.equal(payload.success, true);
	assert.equal(payload.data.usdt.price_toman, 60000);
});

test("OPTIONS preflight remains anonymous and explicitly allows Authorization header", async () => {
	const controller = new ApiController({});
	const response = await controller.route(
		new Request("https://example.test/api/v1/system", { method: "OPTIONS" }),
		new URL("https://example.test/api/v1/system"),
	);
	assert.equal(response.status, 204);
	assert.match(
		response.headers.get("Access-Control-Allow-Headers") || "",
		/(^|,\s*)Authorization(,|$)/,
	);
});

test("database seeds public market mode without changing schema 12", async () => {
	const [database, app] = await Promise.all([
		readFile(new URL("../src/database/database.js", import.meta.url), "utf8"),
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
	]);
	assert.match(database, /market_api_mode: "public"/);
	assert.match(app, /schemaVersion:\s*13/);
});

test("composition root shares one access policy service with settings and token service", async () => {
	const source = await readFile(new URL("../src/app/container.js", import.meta.url), "utf8");
	assert.equal(
		(source.match(/new ApiAccessService\(settings, apiTokens\)/g) || []).length,
		1,
	);
	assert.match(source, /apiAccess,/);
});

test("API enforcement is centralized before endpoint switch work", async () => {
	const source = await readFile(
		new URL("../src/controllers/api.controller.js", import.meta.url),
		"utf8",
	);
	const authIndex = source.indexOf("await this.s.apiAccess.authorize(request, url.pathname)");
	const switchIndex = source.indexOf("switch (url.pathname)");
	assert.ok(authIndex >= 0);
	assert.ok(switchIndex > authIndex);
	assert.match(source, /accessErrorResponse/);
});

test("Phase 15.2 keeps app version 0.2.0 and schema 12", async () => {
	const source = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(source, /version:\s*"0\.2\.0"/);
	assert.match(source, /schemaVersion:\s*13/);
});
