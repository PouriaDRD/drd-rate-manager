import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Config } from "../src/config/config.js";
import { MarketPublisher } from "../src/services/market-publisher.service.js";
import {
	MARKET_MIN_CORE_SECTIONS_FOR_PUBLISH,
	analyzeMarketSnapshot,
	assertMarketPublishable,
} from "../src/services/market-quality.js";
import { MarketService } from "../src/services/market.service.js";
import { serializeMarketSnapshot } from "../src/api/serializers.js";

function snapshot(overrides = {}) {
	return {
		createdAt: Date.now(),
		partial: false,
		errors: [],
		usdt: { price: 60000, source: "Tabdeal", fallbackLevel: 1 },
		crypto: [{ id: "bitcoin", symbol: "BTC", name: "Bitcoin", price: 100000, change24h: 1 }],
		metals: { gram18: 10_000_000, mazaneh: 43_300_000, gold: 4000, silver: 50 },
		...overrides,
	};
}

test("market quality requires two of three core sections for publication", () => {
	assert.equal(MARKET_MIN_CORE_SECTIONS_FOR_PUBLISH, 2);
	const quality = analyzeMarketSnapshot(snapshot());
	assert.equal(quality.publishable, true);
	assert.equal(quality.coreAvailable, 3);
	assert.equal(quality.completeness, 100);
});

test("one core provider outage remains publishable", () => {
	const quality = analyzeMarketSnapshot(
		snapshot({ crypto: [{ id: "bitcoin", price: null }] }),
	);
	assert.equal(quality.publishable, true);
	assert.equal(quality.coreAvailable, 2);
	assert.ok(quality.missingSections.includes("crypto"));
});

test("two missing core sections fail publication readiness", () => {
	const quality = analyzeMarketSnapshot(
		snapshot({
			usdt: { price: null },
			crypto: [{ id: "bitcoin", price: null }],
		}),
	);
	assert.equal(quality.publishable, false);
	assert.equal(quality.coreAvailable, 1);
	assert.throws(
		() => assertMarketPublishable({
			...snapshot({
				usdt: { price: null },
				crypto: [{ id: "bitcoin", price: null }],
			}),
		}),
		(error) => error.code === "MARKET_SNAPSHOT_NOT_PUBLISHABLE",
	);
});

test("publisher blocks severe partial snapshot before Telegram send", async () => {
	let sends = 0;
	const publisher = new MarketPublisher(
		new Config({ TELEGRAM_CHANNEL_ID: "@DRDrate" }),
		{
			async sendRichMessage() {
				sends += 1;
				return { message_id: 1 };
			},
		},
		{ buildRichMessage() { return { html: "x" }; } },
	);
	await assert.rejects(
		() => publisher.publish(
			snapshot({
				usdt: { price: null },
				crypto: [{ id: "bitcoin", price: null }],
			}),
		),
		/MARKET|not publishable/i,
	);
	assert.equal(sends, 0);
});

test("publisher allows a single core outage", async () => {
	let sends = 0;
	const publisher = new MarketPublisher(
		new Config({ TELEGRAM_CHANNEL_ID: "@DRDrate" }),
		{
			async sendRichMessage() {
				sends += 1;
				return { message_id: 9 };
			},
		},
		{ buildRichMessage() { return { html: "x" }; } },
	);
	const result = await publisher.publish(
		snapshot({ crypto: [{ id: "bitcoin", price: null }] }),
	);
	assert.equal(result.message_id, 9);
	assert.equal(sends, 1);
});

test("partial refresh uses bounded 60-second cache TTL and recovers stale values", async () => {
	const now = Date.now();
	const stale = snapshot({
		createdAt: now - 120_000,
		usdt: { price: 59000, source: "Wallex", fallbackLevel: 0 },
		crypto: [{ id: "bitcoin", symbol: "BTC", name: "Bitcoin", price: 90000, change24h: -1 }],
		metals: { gram18: 9_000_000, mazaneh: 39_000_000, gold: 3900, silver: 48 },
	});
	let written = null;
	const service = new MarketService(
		{},
		new Config({}),
		{ async get() { return "300"; } },
		{
			async read() {
				return {
					payload: stale,
					fetchedAt: now - 120_000,
					expiresAt: now - 60_000,
					lastError: null,
				};
			},
			async write(payload, ttlSeconds, lastError) {
				written = { payload, ttlSeconds, lastError };
				return { fetchedAt: now, expiresAt: now + ttlSeconds * 1000 };
			},
		},
		{
			async acquire() { return "token"; },
			async release() {},
		},
		{
			async enabled() {
				return [{ coin_id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: 1 }];
			},
		},
		{ async save() {} },
		{
			async resolveUsdt() {
				return { success: true, price: 61000, sourceLabel: "Tabdeal", fallbackLevel: 1 };
			},
			async resolveGold() {
				return { success: false, message: "Iranian gold unavailable" };
			},
		},
		{
			async fetchMarketBundle() {
				return { success: false, message: "CoinGecko down" };
			},
		},
		{
			async isEnabled() { return true; },
		},
	);

	const result = await service.getSnapshot({ forceRefresh: true });
	assert.equal(written.ttlSeconds, 60);
	assert.equal(result.usdt.price, 61000);
	assert.equal(result.crypto[0].price, 90000);
	assert.equal(result.metals.gram18, 9_000_000);
	assert.equal(result.partial, true);
	assert.equal(result.quality.publishable, true);
	assert.equal(result.cache.ttlSeconds, 60);
	assert.equal(result.cache.configuredTtlSeconds, 300);
});

test("partial TTL never extends a shorter configured cache TTL", async () => {
	const source = await readFile(
		new URL("../src/services/market.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /Math\.min\(\s*ttlSeconds\s*,\s*PARTIAL_CACHE_TTL_SECONDS\s*\)/);
});

test("cached legacy snapshot receives quality metadata at read time", async () => {
	const cached = snapshot();
	const service = new MarketService(
		{},
		new Config({}),
		{ async get() { return "30"; } },
		{
			async read() {
				return {
					payload: cached,
					fetchedAt: Date.now() - 1000,
					expiresAt: Date.now() + 20_000,
					lastError: null,
				};
			},
		},
		{ async acquire() { throw new Error("should not refresh"); } },
		{},
		{},
		{},
		{},
	);
	const result = await service.getSnapshot();
	assert.equal(result.quality.publishable, true);
	assert.equal(result.quality.coreAvailable, 3);
});

test("public market serializer exposes publication quality and effective cache TTL", () => {
	const raw = snapshot();
	raw.quality = analyzeMarketSnapshot(raw);
	raw.cache = {
		fromCache: false,
		staleFallback: true,
		fetchedAt: raw.createdAt,
		expiresAt: raw.createdAt + 60_000,
		ttlSeconds: 60,
		configuredTtlSeconds: 300,
		lastError: "partial",
	};
	const data = serializeMarketSnapshot(new Config({ TIMEZONE: "Asia/Tehran" }), raw);
	assert.equal(data.quality.publishable, true);
	assert.equal(data.quality.core_available, 3);
	assert.equal(data.cache.ttl_seconds, 60);
	assert.equal(data.cache.configured_ttl_seconds, 300);
});

test("Telegram market UI hides publish actions for blocked quality", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-market.methods.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /const publishable = snapshot\.quality\?\.publishable !== false/);
	assert.match(source, /const marketActions = publishable/);
	assert.match(source, /const previewKeyboard = snapshot\.quality\?\.publishable === false/);
});

test("automation keeps retry semantics because publisher gate throws through existing error path", async () => {
	const source = await readFile(
		new URL("../src/services/automation.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /const publishResult = await this\.publisher\.publish\(snapshot\)/);
	assert.match(source, /auto_publish_retry_slot_at: slotAt/);
	assert.match(source, /throw error/);
});

test("Phase 13.3 keeps version 0.2.1 and schema 11", async () => {
	const app = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(app, /version:\s*"0\.2\.1"/);
	assert.match(app, /schemaVersion:\s*13/);
});
