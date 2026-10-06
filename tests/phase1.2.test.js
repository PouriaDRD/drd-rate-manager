import assert from "node:assert/strict";
import test from "node:test";

import { Config } from "../src/config/config.js";
import { CoinGeckoClient } from "../src/clients/coingecko.client.js";
import { HttpClient } from "../src/clients/http.client.js";
import { TelegramClient } from "../src/clients/telegram.client.js";
import { MarketSources } from "../src/market/market-sources.js";
import { MarketPostBuilder } from "../src/market/market-post.builder.js";
import { AutomationService } from "../src/services/automation.service.js";
import { MarketPublisher } from "../src/services/market-publisher.service.js";
import { MarketService } from "../src/services/market.service.js";
import { resolveUsdtChecks } from "../src/services/market-support.js";

function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async json() { return body; },
		async text() { return JSON.stringify(body); },
	};
}

test("phase 1.2 modules expose the current production contracts", () => {
	assert.equal(typeof HttpClient.prototype.fetch, "function");
	assert.equal(typeof CoinGeckoClient.prototype.fetchMarketBundle, "function");
	assert.equal(typeof TelegramClient.prototype.sendRichMessage, "function");
	assert.equal(typeof MarketSources.prototype.resolveUsdt, "function");
	assert.equal(typeof MarketService.prototype.getSnapshot, "function");
	assert.equal(typeof MarketPostBuilder.prototype.buildRichMessage, "function");
	assert.equal(typeof MarketPublisher.prototype.publish, "function");
	assert.equal(typeof AutomationService.prototype.tick, "function");
});

test("CoinGecko market bundle still uses exactly one request", async () => {
	const calls = [];
	const http = {
		async fetch(url, init, timeoutMs) {
			calls.push({ url, init, timeoutMs });
			return jsonResponse([
				{ id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 100, price_change_percentage_24h: 2, market_cap_rank: 1 },
				{ id: "ethereum", symbol: "eth", name: "Ethereum", current_price: 50, price_change_percentage_24h: -1, market_cap_rank: 2 },
				{ id: "tether-gold", symbol: "xaut", name: "Tether Gold", current_price: 4000 },
				{ id: "kinesis-silver", symbol: "kag", name: "Kinesis Silver", current_price: 50 },
			]);
		},
		async sourceError(response) { return `HTTP ${response.status}`; },
	};
	const env = { COINGECKO_API_KEY: "test-key", COINGECKO_API_PLAN: "demo" };
	const client = new CoinGeckoClient(env, new Config(env), http);
	const result = await client.fetchMarketBundle([
		{ coin_id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 },
		{ coin_id: "ethereum", symbol: "ETH", name: "Ethereum", market_cap_rank: 2 },
	]);

	assert.equal(calls.length, 1);
	assert.match(calls[0].url, /bitcoin%2Cethereum%2Ctether-gold%2Ckinesis-silver/);
	assert.equal(result.success, true);
	assert.equal(result.crypto.length, 2);
	assert.equal(result.gold, 4000);
	assert.equal(result.silver, 50);
});

test("USDT source fallback order remains Wallex -> Tabdeal -> Exir", async () => {
	const requested = [];
	const env = {
		WALLEX_API_URL: "https://test.local/wallex",
		TABDEAL_API_URL: "https://test.local/tabdeal",
		EXIR_API_URL: "https://test.local/exir",
	};
	const http = {
		async fetch(url) {
			requested.push(url);
			if (url.includes("wallex")) return jsonResponse({}, 503);
			if (url.includes("tabdeal")) return jsonResponse({ asks: [["61234"]] }, 200);
			return jsonResponse({ asks: [["70000"]] }, 200);
		},
		async sourceError(response) { return `HTTP ${response.status}`; },
	};
	const saved = [];
	const statuses = {
		async save(source, result) { saved.push({ source, result }); },
		async saveMany() {},
	};
	const sources = new MarketSources(env, http, statuses);
	const result = await sources.resolveUsdt();

	assert.deepEqual(requested, [env.WALLEX_API_URL, env.TABDEAL_API_URL]);
	assert.equal(result.success, true);
	assert.equal(result.source, "tabdeal");
	assert.equal(result.sourceLabel, "Tabdeal");
	assert.equal(result.fallbackLevel, 1);
	assert.equal(result.price, 61234);
	assert.deepEqual(saved.map((item) => item.source), ["wallex", "tabdeal"]);
});

test("resolveUsdtChecks preserves source priority", () => {
	const result = resolveUsdtChecks({
		wallex: { success: false, price: null },
		tabdeal: { success: true, price: 60000 },
		exir: { success: true, price: 61000 },
	});
	assert.equal(result.source, "tabdeal");
	assert.equal(result.fallbackLevel, 1);
});

test("market post builder preserves rich and fallback message structure", () => {
	const config = new Config({
		TIMEZONE: "Asia/Tehran",
		TELEGRAM_CHANNEL_HANDLE: "@DRDrate",
	});
	const builder = new MarketPostBuilder(config);
	const snapshot = {
		createdAt: Date.UTC(2026, 9, 5, 8, 0, 0),
		usdt: { price: 60000 },
		crypto: [
			{ id: "bitcoin", symbol: "BTC", name: "Bitcoin", price: 100000, change24h: 1.5 },
			{ id: "ethereum", symbol: "ETH", name: "Ethereum", price: 5000, change24h: -2 },
		],
		metals: { gram18: 10000000, mazaneh: 43300000, gold: 4000, silver: 50 },
	};
	const rich = builder.buildRichMessage(snapshot);
	const fallback = builder.buildFallbackHtml(snapshot);

	assert.equal(rich.is_rtl, true);
	assert.match(rich.html, /نبض بازار/);
	assert.match(rich.html, /<details>/);
	assert.match(rich.html, /DRDrate/);
	assert.match(fallback, /بیت‌کوین/);
	assert.match(fallback, /اتریوم/);
	assert.match(fallback, /DRDrate/);
});

test("market publisher preserves configured Telegram channel", async () => {
	const calls = [];
	const config = new Config({ TELEGRAM_CHANNEL_ID: "@DRDrate" });
	const telegram = {
		async sendRichMessage(chatId, richMessage) {
			calls.push({ chatId, richMessage });
			return { message_id: 123 };
		},
	};
	const builder = { buildRichMessage: () => ({ html: "test", is_rtl: true }) };
	const publisher = new MarketPublisher(config, telegram, builder);
	const result = await publisher.publish({
		usdt: { price: 60000 },
		crypto: [{ id: "bitcoin", price: 100000 }],
		metals: { gram18: null, gold: null, silver: null },
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].chatId, "@DRDrate");
	assert.equal(result.message_id, 123);
});

test("market service preserves fresh-cache short circuit", async () => {
	let sourceCalls = 0;
	const snapshot = { createdAt: Date.now(), partial: false, errors: [], usdt: {}, crypto: [], metals: {} };
	const settings = { async get() { return "30"; } };
	const cache = {
		async read() {
			return {
				payload: snapshot,
				fetchedAt: Date.now() - 1000,
				expiresAt: Date.now() + 20_000,
				lastError: null,
			};
		},
	};
	const locks = { async acquire() { throw new Error("lock should not be acquired"); } };
	const sources = { async resolveUsdt() { sourceCalls += 1; } };
	const service = new MarketService(
		{},
		new Config({}),
		settings,
		cache,
		locks,
		{ async enabled() { return []; } },
		{ async save() {} },
		sources,
		{ async fetchMarketBundle() { sourceCalls += 1; } },
	);

	const result = await service.getSnapshot();
	assert.equal(result.cache.fromCache, true);
	assert.equal(result.cache.staleFallback, false);
	assert.equal(sourceCalls, 0);
});

test("automation service preserves current interval-not-due behavior", async () => {
	const now = Date.now();
	const values = {
		bot_enabled: "1",
		auto_publish_enabled: "1",
		publish_interval_minutes: "5",
		quiet_hours_enabled: "0",
		quiet_hours_start: "01:00",
		quiet_hours_end: "10:30",
		auto_publish_last_run_at: String(now),
		auto_publish_last_tick_at: String(now),
	};
	const settings = {
		async getMany(keys) {
			return Object.fromEntries(keys.map((key) => [key, values[key] ?? ""]));
		},
		async set() {},
		async setMany() { throw new Error("publish path should not run"); },
	};
	const service = new AutomationService(
		{ DB: { prepare() { throw new Error("claim should not run"); } } },
		new Config({ TIMEZONE: "Asia/Tehran" }),
		settings,
		{ async getSnapshot() { throw new Error("market should not run"); } },
		{ async publish() { throw new Error("publisher should not run"); } },
	);

	const result = await service.tick();
	assert.equal(result, undefined);
});
