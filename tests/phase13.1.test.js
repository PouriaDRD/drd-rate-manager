import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CoinGeckoClient } from "../src/clients/coingecko.client.js";
import { MarketSources } from "../src/market/market-sources.js";
import {
	PROVIDER_RESILIENCE_POLICY,
	ProviderResilienceService,
	classifyProviderFailure,
} from "../src/services/provider-resilience.service.js";

class FakeLocks {
	constructor(now) {
		this.now = now;
		this.rows = new Map();
		this.sequence = 0;
	}
	async peek(key) {
		const row = this.rows.get(key);
		if (!row) return null;
		return {
			expiresAt: row.expiresAt,
			updatedAt: row.updatedAt,
			leaseMs: row.expiresAt - row.updatedAt,
		};
	}
	async acquire(key, ttlMs) {
		const now = this.now();
		const row = this.rows.get(key);
		if (row && row.expiresAt > now) return null;
		const token = `token-${++this.sequence}`;
		this.rows.set(key, { token, updatedAt: now, expiresAt: now + ttlMs });
		return token;
	}
	async extend(key, token, ttlMs) {
		const row = this.rows.get(key);
		if (!row || row.token !== token) return false;
		const now = this.now();
		this.rows.set(key, { token, updatedAt: now, expiresAt: now + ttlMs });
		return true;
	}
	async release(key, token) {
		const row = this.rows.get(key);
		if (row?.token === token) this.rows.delete(key);
	}
}

function clock(start = 1_800_000_000_000) {
	let value = start;
	return {
		now: () => value,
		advance(ms) { value += ms; },
	};
}
function setup() {
	const time = clock();
	const locks = new FakeLocks(time.now);
	return {
		time,
		locks,
		resilience: new ProviderResilienceService(locks, { now: time.now }),
	};
}

test("provider failure classification separates major failure classes", () => {
	assert.equal(classifyProviderFailure({ status: 429, message: "rate" }), "rate_limited");
	assert.equal(classifyProviderFailure({ status: 403, message: "forbidden" }), "access_denied");
	assert.equal(classifyProviderFailure({ status: 503, message: "down" }), "server_error");
	assert.equal(classifyProviderFailure({ status: null, message: "request timeout" }), "timeout");
	assert.equal(classifyProviderFailure({ status: null, message: "socket failed" }), "network_error");
	assert.equal(classifyProviderFailure({ status: 200, message: "bad shape" }), "invalid_response");
	assert.equal(classifyProviderFailure({ status: null, message: "API key missing" }), "configuration");
});

test("success releases provider lease immediately", async () => {
	const { resilience, locks } = setup();
	const result = await resilience.execute("wallex", async () => ({
		success: true, status: 200, price: 60000, message: null,
	}));
	assert.equal(result.resilience.state, "closed");
	assert.equal(await locks.peek("provider:wallex"), null);
});

test("503 opens cooldown and next retry skips HTTP work", async () => {
	const { resilience, locks } = setup();
	let calls = 0;
	const first = await resilience.execute("wallex", async () => {
		calls += 1;
		return { success: false, status: 503, message: "down" };
	});
	assert.equal(first.resilience.classification, "server_error");
	assert.ok((await locks.peek("provider:wallex")).leaseMs >= 45_000);

	const second = await resilience.execute("wallex", async () => {
		calls += 1;
		return { success: true, status: 200 };
	});
	assert.equal(second.skipped, true);
	assert.equal(calls, 1);
});

test("expired cooldown allows one half-open probe while concurrent caller is skipped", async () => {
	const { resilience, time } = setup();
	await resilience.execute("tabdeal", async () => ({
		success: false, status: 503, message: "down",
	}));
	time.advance(PROVIDER_RESILIENCE_POLICY.cooldownMs.server_error + 1);

	let resolveProbe;
	const pending = resilience.execute("tabdeal", () => new Promise((resolve) => {
		resolveProbe = resolve;
	}));
	await new Promise((resolve) => setTimeout(resolve, 0));

	const concurrent = await resilience.execute("tabdeal", async () => ({
		success: true, status: 200,
	}));
	assert.equal(concurrent.skipped, true);
	assert.equal(concurrent.resilience.state, "probe_in_progress");

	resolveProbe({ success: true, status: 200, price: 61000 });
	const probe = await pending;
	assert.equal(probe.success, true);
});

test("429 and 403 use stronger cooldown classes", async () => {
	const rate = setup();
	const a = await rate.resilience.execute("coingecko", async () => ({
		success: false, status: 429, message: "rate limited",
	}));
	assert.equal(a.resilience.cooldownMs, PROVIDER_RESILIENCE_POLICY.cooldownMs.rate_limited);

	const denied = setup();
	const b = await denied.resilience.execute("wallex", async () => ({
		success: false, status: 403, message: "forbidden",
	}));
	assert.equal(b.resilience.cooldownMs, PROVIDER_RESILIENCE_POLICY.cooldownMs.access_denied);
});

test("resilience storage failure fails open instead of blocking providers", async () => {
	const resilience = new ProviderResilienceService({
		async peek() { throw new Error("D1 unavailable"); },
	});
	let calls = 0;
	const result = await resilience.execute("exir", async () => {
		calls += 1;
		return { success: true, status: 200, price: 62000 };
	});
	assert.equal(result.success, true);
	assert.equal(calls, 1);
});

test("USDT fallback skips cooled Wallex and reaches Tabdeal", async () => {
	const { resilience } = setup();
	const requested = [];
	let wallexCalls = 0;
	const statuses = { async save() {}, async saveMany() {} };
	const sourceSettings = {
		async usdtPriority() { return ["wallex", "tabdeal", "exir"]; },
		async isEnabled() { return true; },
	};
	const http = {
		async fetch(url) {
			requested.push(url);
			if (url.includes("wallex")) {
				wallexCalls += 1;
				return { ok: false, status: 503, async text() { return "down"; } };
			}
			return { ok: true, status: 200, async json() { return { asks: [["61234"]] }; } };
		},
		async sourceError(response) { return `HTTP ${response.status}`; },
	};
	const sources = new MarketSources(
		{
			WALLEX_API_URL: "https://test/wallex",
			TABDEAL_API_URL: "https://test/tabdeal",
			EXIR_API_URL: "https://test/exir",
		},
		http,
		statuses,
		null,
		sourceSettings,
		resilience,
	);

	assert.equal((await sources.resolveUsdt()).source, "tabdeal");
	assert.equal(wallexCalls, 1);
	requested.length = 0;
	assert.equal((await sources.resolveUsdt()).source, "tabdeal");
	assert.equal(wallexCalls, 1);
	assert.deepEqual(requested, ["https://test/tabdeal"]);
});

test("CoinGecko cooldown prevents repeated HTTP after 429", async () => {
	const { resilience } = setup();
	let calls = 0;
	const client = new CoinGeckoClient(
		{ COINGECKO_API_KEY: "key" },
		{
			coinGeckoBaseUrl: "https://example.test",
			coinGeckoHeaders() { return {}; },
			coinGeckoTopLimit: 20,
		},
		{
			async fetch() {
				calls += 1;
				return { ok: false, status: 429, async text() { return "rate"; } };
			},
			async sourceError(response) { return `HTTP ${response.status}`; },
		},
		resilience,
	);
	const first = await client.fetchMarketBundle([]);
	assert.equal(first.resilience.classification, "rate_limited");
	assert.equal((await client.fetchMarketBundle([])).skipped, true);
	assert.equal(calls, 1);
});

test("missing CoinGecko key becomes configuration cooldown without network access", async () => {
	const { resilience } = setup();
	let calls = 0;
	const client = new CoinGeckoClient(
		{},
		{ coinGeckoBaseUrl: "x", coinGeckoHeaders() { return {}; }, coinGeckoTopLimit: 20 },
		{ async fetch() { calls += 1; } },
		resilience,
	);
	assert.equal((await client.fetchMarketBundle([])).resilience.classification, "configuration");
	assert.equal((await client.fetchMarketBundle([])).skipped, true);
	assert.equal(calls, 0);
});

test("source status skips do not overwrite the last actual provider check", async () => {
	const source = await readFile(
		new URL("../src/repositories/source-status.repository.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /if \(status\?\.skipped\) return false/);
});

test("lock repository exposes persistent lease peek and extend", async () => {
	const source = await readFile(
		new URL("../src/repositories/lock.repository.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /async peek\(key\)/);
	assert.match(source, /async extend\(key, token, ttlMs\)/);
});

test("composition root shares one resilience service across providers", async () => {
	const source = await readFile(
		new URL("../src/app/container.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /new ProviderResilienceService\(locks\)/);
	assert.match(source, /new CoinGeckoClient\(runtimeEnv, config, http, resilience\)/);
	assert.match(
		source,
		/new MarketSources\(runtimeEnv, http, statuses, config, sourceSettings, resilience\)/,
	);
});

test("Phase 13.1 reuses runtime_locks without schema or app-version bump", async () => {
	const app = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	const database = await readFile(new URL("../src/database/database.js", import.meta.url), "utf8");
	assert.match(app, /version:\s*"0\.13\.0"/);
	assert.match(app, /schemaVersion:\s*12/);
	assert.doesNotMatch(database, /provider_resilience/);
});

test("provider circuit breaker preserves configured USDT priority semantics", async () => {
	const market = await readFile(
		new URL("../src/market/market-sources.js", import.meta.url),
		"utf8",
	);
	assert.match(market, /sourceSettings\.usdtPriority/);
	assert.match(market, /fallbackLevel: index/);
});
