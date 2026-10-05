import test from "node:test";
import assert from "node:assert/strict";

import { APP, USDT_SOURCE_PRIORITY } from "../src/config/app.js";
import { Config } from "../src/config/config.js";
import {
	coinNameFa,
	normalizeDigits,
	nullableNumber,
	parseBoolean,
	safeJson,
	sourceLabel,
	validTime,
} from "../src/utils/core.js";
import {
	calculateMazanehFromGram18,
	formatFaInteger,
	roundToNearest,
} from "../src/utils/formatters.js";
import { normalizePublishInterval } from "../src/utils/automation.js";

test("application constants preserve v0.13.0 behavior", () => {
	assert.equal(APP.version, "0.13.0");
	assert.equal(APP.schemaVersion, 10);
	assert.deepEqual(APP.publishIntervals, [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
	assert.deepEqual(USDT_SOURCE_PRIORITY, ["wallex", "tabdeal", "exir"]);
});

test("Config preserves current env-backed defaults", () => {
	const config = new Config({});
	assert.equal(config.version, "0.13.0");
	assert.equal(config.timezone, "Asia/Tehran");
	assert.equal(config.displayName, "DRD Rate Manager");
	assert.equal(config.coinGeckoPlan, "demo");
	assert.equal(config.coinGeckoTopLimit, 20);
	assert.deepEqual(config.defaultCoinGeckoAssets, [
		"bitcoin", "ethereum", "binancecoin", "ripple", "solana", "tron",
	]);
});

test("Config preserves configured values", () => {
	const config = new Config({
		APP_VERSION: "x",
		TIMEZONE: "UTC",
		BOT_DISPLAY_NAME: "Bot",
		TELEGRAM_CHANNEL_ID: "-1001",
		TELEGRAM_CHANNEL_HANDLE: "DRDrate",
		TELEGRAM_OWNER_ID: "123",
		COINGECKO_API_PLAN: "pro",
		COINGECKO_TOP_LIMIT: "99",
		COINGECKO_DEFAULT_ASSETS: "bitcoin,ethereum",
		COINGECKO_API_KEY: "secret",
	});
	assert.equal(config.version, "x");
	assert.equal(config.timezone, "UTC");
	assert.equal(config.channelId, "-1001");
	assert.equal(config.channelHandle, "@DRDrate");
	assert.equal(config.ownerId, "123");
	assert.equal(config.coinGeckoPlan, "pro");
	assert.equal(config.coinGeckoTopLimit, 50);
	assert.deepEqual(config.defaultCoinGeckoAssets, ["bitcoin", "ethereum"]);
	assert.equal(config.coinGeckoHeaders()["x-cg-pro-api-key"], "secret");
});

test("foundation helpers preserve current behavior", () => {
	assert.equal(parseBoolean("1"), true);
	assert.equal(parseBoolean("off"), false);
	assert.equal(parseBoolean("", true), true);
	assert.equal(validTime("10:30"), true);
	assert.equal(validTime("25:00"), false);
	assert.equal(normalizePublishInterval(5), 5);
	assert.equal(normalizePublishInterval(7), 10);
	assert.equal(normalizeDigits("۱۲٣"), "123");
	assert.equal(sourceLabel("wallex"), "Wallex");
	assert.equal(coinNameFa("bitcoin"), "بیت‌کوین");
	assert.deepEqual(safeJson('{"a":1}'), { a: 1 });
	assert.equal(safeJson("bad", null), null);
});

test("market formatting helpers preserve current calculations", () => {
	assert.equal(nullableNumber("12.5"), 12.5);
	assert.equal(roundToNearest(12345, 1000), 12000);
	assert.equal(calculateMazanehFromGram18(1_000_000), Math.round(1_000_000 * 4.6083 * (705 / 750)));
	assert.equal(formatFaInteger(123456), "۱۲۳٬۴۵۶");
});
