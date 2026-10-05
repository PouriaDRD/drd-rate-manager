import assert from "node:assert/strict";
import test from "node:test";

import { Config } from "../src/config/config.js";
import {
	RUNTIME_SETTING_DEFINITIONS,
	runtimeSettingSeedValues,
} from "../src/config/runtime-settings.js";
import { SettingsService } from "../src/services/settings.service.js";

class MemorySettingsRepository {
	constructor(values = {}) {
		this.values = { ...values };
	}

	async getMany(keys) {
		return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, this.values[key]]));
	}

	async set(key, value) {
		this.values[key] = String(value);
	}

	async setMany(values) {
		for (const [key, value] of Object.entries(values)) this.values[key] = String(value);
	}
}

test("runtime setting catalog excludes secrets", () => {
	const envKeys = new Set(RUNTIME_SETTING_DEFINITIONS.map((item) => item.legacyEnvKey));
	assert.equal(envKeys.has("TELEGRAM_BOT_TOKEN"), false);
	assert.equal(envKeys.has("TELEGRAM_WEBHOOK_SECRET"), false);
	assert.equal(envKeys.has("COINGECKO_API_KEY"), false);
	assert.equal(envKeys.has("CLOUDFLARE_API_TOKEN"), false);
	assert.equal(envKeys.has("TIMEZONE"), true);
	assert.equal(envKeys.has("WALLEX_API_URL"), true);
});

test("runtime settings resolve legacy env before D1 is loaded", () => {
	const env = { TIMEZONE: "Europe/Amsterdam", COINGECKO_TOP_LIMIT: "33" };
	const service = new SettingsService(env, new MemorySettingsRepository());
	assert.equal(service.get("general.timezone"), "Europe/Amsterdam");
	assert.equal(service.get("coingecko.top_limit"), 33);
	assert.equal(service.getSource("general.timezone"), "env");
});

test("D1 values take priority over legacy env after refresh", async () => {
	const env = { TIMEZONE: "Europe/Amsterdam", TELEGRAM_CHANNEL_HANDLE: "@LegacyChannel" };
	const repository = new MemorySettingsRepository({
		"general.timezone": "Asia/Tehran",
		"telegram.channel_handle": "@DRDrate",
	});
	const service = new SettingsService(env, repository);
	await service.refresh();
	assert.equal(service.get("general.timezone"), "Asia/Tehran");
	assert.equal(service.get("telegram.channel_handle"), "@DRDrate");
	assert.equal(service.getSource("general.timezone"), "d1");
});

test("runtime settings fall back to code defaults when env and D1 are absent", () => {
	const service = new SettingsService({}, new MemorySettingsRepository());
	assert.equal(service.get("general.timezone"), "Asia/Tehran");
	assert.equal(service.get("coingecko.plan"), "demo");
	assert.equal(service.get("cloudflare.d1_database_limit_mb"), 500);
	assert.equal(service.getSource("general.timezone"), "default");
});

test("legacy migration seed copies valid env values and sanitizes invalid values", () => {
	const values = runtimeSettingSeedValues({
		TIMEZONE: "Europe/Amsterdam",
		TELEGRAM_CHANNEL_HANDLE: "DRDrate",
		COINGECKO_TOP_LIMIT: "5000",
	});
	assert.equal(values["general.timezone"], "Europe/Amsterdam");
	assert.equal(values["telegram.channel_handle"], "@DRDrate");
	assert.equal(values["coingecko.top_limit"], "20");
});

test("invalid D1 runtime value fails safe to legacy/default without breaking config", async () => {
	const repository = new MemorySettingsRepository({ "general.timezone": "Invalid/Zone" });
	const service = new SettingsService({ TIMEZONE: "Asia/Tehran" }, repository);
	await service.refresh();
	assert.equal(service.get("general.timezone"), "Asia/Tehran");
	assert.equal(service.getSource("general.timezone"), "d1_invalid");
	assert.deepEqual(service.status().invalidD1Keys, ["general.timezone"]);
});

test("SettingsService validates and normalizes managed writes", async () => {
	const repository = new MemorySettingsRepository();
	const service = new SettingsService({}, repository);
	assert.equal(await service.set("telegram.channel_handle", "DRDrate"), "@DRDrate");
	assert.equal(repository.values["telegram.channel_handle"], "@DRDrate");
	assert.equal(await service.set("coingecko.top_limit", 25), 25);
	await assert.rejects(() => service.set("general.timezone", "Not/A_Timezone"), /Invalid timezone/);
	await assert.rejects(() => service.set("providers.wallex_api_url", "javascript:alert(1)"), /Unsupported URL protocol/);
});

test("SettingsService migration status reports D1 coverage", async () => {
	const repository = new MemorySettingsRepository(runtimeSettingSeedValues({}));
	const service = new SettingsService({}, repository);
	await service.refresh();
	const status = service.status();
	assert.equal(status.fullyMigrated, true);
	assert.equal(status.d1Count, status.total);
	assert.deepEqual(status.legacyFallbackKeys, []);
});

test("Config reads non-secret runtime settings from SettingsService", async () => {
	const repository = new MemorySettingsRepository({
		"general.timezone": "Europe/Amsterdam",
		"general.bot_display_name": "Custom Rate Manager",
		"telegram.owner_id": "123456789",
		"telegram.channel_id": "@CustomRate",
		"telegram.channel_handle": "@CustomRate",
		"coingecko.plan": "pro",
		"coingecko.top_limit": "30",
		"coingecko.default_assets": "bitcoin,ethereum",
		"providers.wallex_api_url": "https://example.com/wallex",
		"providers.tabdeal_api_url": "https://example.com/tabdeal",
		"providers.exir_api_url": "https://example.com/exir",
		"providers.wallgold_api_url": "https://example.com/wallgold",
		"cloudflare.account_id": "account-1",
		"cloudflare.d1_database_id": "database-1",
		"cloudflare.d1_database_limit_mb": "750",
	});
	const settingsService = new SettingsService({}, repository);
	const config = new Config({
		TELEGRAM_BOT_TOKEN: "bot-secret",
		TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
		COINGECKO_API_KEY: "cg-secret",
		CLOUDFLARE_API_TOKEN: "cf-secret",
	}, settingsService);
	await config.refresh();

	assert.equal(config.timezone, "Europe/Amsterdam");
	assert.equal(config.displayName, "Custom Rate Manager");
	assert.equal(config.ownerId, "123456789");
	assert.equal(config.channelId, "@CustomRate");
	assert.equal(config.coinGeckoPlan, "pro");
	assert.equal(config.coinGeckoTopLimit, 30);
	assert.deepEqual(config.defaultCoinGeckoAssets, ["bitcoin", "ethereum"]);
	assert.equal(config.wallexApiUrl, "https://example.com/wallex");
	assert.equal(config.d1DatabaseLimitMb, 750);
	assert.equal(config.telegramBotToken, "bot-secret");
	assert.equal(config.telegramWebhookSecret, "webhook-secret");
	assert.equal(config.coinGeckoApiKey, "cg-secret");
	assert.equal(config.cloudflareApiToken, "cf-secret");
});
