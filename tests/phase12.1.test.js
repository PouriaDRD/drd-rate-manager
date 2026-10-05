import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Config } from "../src/config/config.js";
import {
	APPLICATION_IDENTITY_ENV_KEYS,
	CONFIG_OWNERSHIP_VERSION,
	INFRASTRUCTURE_BINDINGS,
	INFRASTRUCTURE_SECRET_ENV_KEYS,
	configurationMigrationReadiness,
	configurationOwnershipSnapshot,
} from "../src/config/config-ownership.js";
import {
	LEGACY_RUNTIME_ENV_KEYS,
	RUNTIME_SETTING_BY_LEGACY_ENV,
	RUNTIME_SETTING_DEFINITIONS,
	RUNTIME_SETTINGS_VERSION,
	runtimeSettingSeedValues,
} from "../src/config/runtime-settings.js";
import {
	LEGACY_SECURE_ENV_KEYS,
	SECURE_SETTING_ENV_MAP,
	SECURE_SETTINGS_VERSION,
} from "../src/config/secure-settings.js";
import { createRuntimeEnv } from "../src/config/runtime-env.js";

test("Phase 12.1 runtime catalog version adds CoinGecko user-agent ownership", () => {
	assert.equal(RUNTIME_SETTINGS_VERSION, 2);
	const definition = RUNTIME_SETTING_DEFINITIONS.find((item) => item.key === "coingecko.user_agent");
	assert.ok(definition);
	assert.equal(definition.legacyEnvKey, "COINGECKO_USER_AGENT");
	assert.equal(RUNTIME_SETTING_BY_LEGACY_ENV.get("COINGECKO_USER_AGENT"), "coingecko.user_agent");
	assert.ok(LEGACY_RUNTIME_ENV_KEYS.includes("COINGECKO_USER_AGENT"));
});

test("runtime migration seed preserves legacy CoinGecko user-agent during D1 transition", () => {
	const values = runtimeSettingSeedValues({
		COINGECKO_USER_AGENT: "Custom-Agent/1.0",
	});
	assert.equal(values["coingecko.user_agent"], "Custom-Agent/1.0");
});

test("Config uses one runtime catalog for fallback when SettingsService is absent", () => {
	const config = new Config({
		TIMEZONE: "Europe/Amsterdam",
		COINGECKO_TOP_LIMIT: "27",
		COINGECKO_USER_AGENT: "Legacy-Agent/2.0",
		WALLEX_API_URL: "https://example.com/wallex",
	});
	assert.equal(config.timezone, "Europe/Amsterdam");
	assert.equal(config.coinGeckoTopLimit, 27);
	assert.equal(config.coinGeckoUserAgent, "Legacy-Agent/2.0");
	assert.equal(config.wallexApiUrl, "https://example.com/wallex");
});

test("bootstrap Config preserves v0.13.0 permissive ENV compatibility", () => {
	const config = new Config({
		TELEGRAM_OWNER_ID: "123",
		COINGECKO_TOP_LIMIT: "99",
		TELEGRAM_CHANNEL_ID: "-1001",
	});
	assert.equal(config.ownerId, "123");
	assert.equal(config.coinGeckoTopLimit, 50);
	assert.equal(config.channelId, "-1001");
});

test("Config derives CoinGecko user-agent when the managed setting is empty", () => {
	const config = new Config({
		APP_VERSION: "0.13.0",
		TELEGRAM_CHANNEL_HANDLE: "@DRDrate",
	});
	assert.equal(config.coinGeckoUserAgent, "DRD-Rate-Manager/0.13.0 (+https://t.me/DRDrate)");
});

test("Config source no longer duplicates managed runtime ENV/default fallback rules", async () => {
	const source = await readFile(new URL("../src/config/config.js", import.meta.url), "utf8");
	assert.match(source, /resolveRuntimeSettingFallback/);
	assert.match(source, /RUNTIME_SETTING_MAP/);
	for (const envKey of [
		"TIMEZONE",
		"BOT_DISPLAY_NAME",
		"TELEGRAM_OWNER_ID",
		"TELEGRAM_CHANNEL_ID",
		"TELEGRAM_CHANNEL_HANDLE",
		"COINGECKO_API_PLAN",
		"COINGECKO_TOP_LIMIT",
		"COINGECKO_DEFAULT_ASSETS",
		"COINGECKO_USER_AGENT",
		"WALLEX_API_URL",
		"TABDEAL_API_URL",
		"EXIR_API_URL",
		"WALLGOLD_API_URL",
		"CLOUDFLARE_ACCOUNT_ID",
		"CLOUDFLARE_D1_DATABASE_ID",
		"D1_DATABASE_LIMIT_MB",
	]) {
		assert.doesNotMatch(source, new RegExp(`this\\\\.env\\\\.${envKey}`), envKey);
	}
});

test("secure runtime env map is derived from the secure setting catalog", () => {
	assert.equal(SECURE_SETTINGS_VERSION, 1);
	assert.deepEqual([...LEGACY_SECURE_ENV_KEYS].sort(), [
		"CLOUDFLARE_API_TOKEN",
		"COINGECKO_API_KEY",
		"TELEGRAM_BOT_TOKEN",
		"TELEGRAM_WEBHOOK_SECRET",
	]);
	assert.equal(SECURE_SETTING_ENV_MAP.TELEGRAM_BOT_TOKEN, "telegram.bot_token");
	assert.equal(SECURE_SETTING_ENV_MAP.CLOUDFLARE_API_TOKEN, "cloudflare.api_token");
});

test("runtime env proxy resolves managed secrets without a duplicate local map", async () => {
	const seen = [];
	const runtimeEnv = createRuntimeEnv(
		{ TELEGRAM_BOT_TOKEN: "legacy", OTHER: "plain" },
		{
			get(key) {
				seen.push(key);
				return key === "telegram.bot_token" ? "encrypted-value" : "";
			},
		},
	);
	assert.equal(runtimeEnv.TELEGRAM_BOT_TOKEN, "encrypted-value");
	assert.equal(runtimeEnv.OTHER, "plain");
	assert.deepEqual(seen, ["telegram.bot_token"]);

	const source = await readFile(new URL("../src/config/runtime-env.js", import.meta.url), "utf8");
	assert.match(source, /SECURE_SETTING_ENV_MAP/);
	assert.doesNotMatch(source, /const ENV_SECRET_MAP/);
});

test("configuration ownership catalog has no runtime/secret/infra overlap", () => {
	const ownership = configurationOwnershipSnapshot();
	assert.equal(CONFIG_OWNERSHIP_VERSION, 1);
	assert.equal(ownership.valid, true);
	assert.deepEqual(ownership.overlaps.runtimeAndSecureKeys, []);
	assert.deepEqual(ownership.overlaps.runtimeAndSecureLegacyEnv, []);
	assert.deepEqual(ownership.overlaps.infraSecretAndLegacySecureEnv, []);
	assert.deepEqual(INFRASTRUCTURE_BINDINGS, ["DB", "ASSETS"]);
	assert.deepEqual(INFRASTRUCTURE_SECRET_ENV_KEYS, ["APP_MASTER_KEY"]);
	assert.deepEqual(APPLICATION_IDENTITY_ENV_KEYS, ["APP_NAME", "APP_VERSION"]);
});

test("ownership snapshot contains metadata only and never live secret values", () => {
	const serialized = JSON.stringify(configurationOwnershipSnapshot());
	assert.match(serialized, /telegram\.bot_token/);
	assert.match(serialized, /TELEGRAM_BOT_TOKEN/);
	assert.doesNotMatch(serialized, /encrypted-value|legacy-secret|super-secret/);
});

test("migration readiness allows legacy ENV removal only after complete D1 migration", () => {
	const ready = configurationMigrationReadiness(
		{
			fullyMigrated: true,
			invalidD1Keys: [],
			legacyFallbackKeys: [],
			defaultFallbackKeys: [],
		},
		{
			legacyFallbackKeys: [],
		},
	);
	assert.equal(ready.canRemoveAllLegacyEnv, true);
	assert.deepEqual(ready.blockers, []);

	const blocked = configurationMigrationReadiness(
		{
			fullyMigrated: false,
			invalidD1Keys: ["general.timezone"],
			legacyFallbackKeys: ["telegram.owner_id"],
			defaultFallbackKeys: ["coingecko.user_agent"],
		},
		{
			legacyFallbackKeys: ["telegram.bot_token"],
		},
	);
	assert.equal(blocked.canRemoveAllLegacyEnv, false);
	assert.equal(blocked.runtimeReady, false);
	assert.equal(blocked.secureReady, false);
	assert.deepEqual(
		blocked.blockers.map((item) => item.code),
		[
			"runtime_settings_invalid",
			"runtime_settings_not_fully_d1",
			"secure_settings_legacy_fallback",
		],
	);
});

test("legacy runtime and secure environment namespaces remain disjoint", () => {
	const runtime = new Set(LEGACY_RUNTIME_ENV_KEYS);
	for (const secret of LEGACY_SECURE_ENV_KEYS) {
		assert.equal(runtime.has(secret), false, secret);
	}
	assert.equal(runtime.has("APP_MASTER_KEY"), false);
});

test("Phase 12.1 keeps schema migration independent from configuration catalog version", async () => {
	const database = await readFile(new URL("../src/database/database.js", import.meta.url), "utf8");
	assert.match(database, /RUNTIME_SETTINGS_VERSION/);
	assert.match(database, /runtimeSettingSeedValues/);
	assert.doesNotMatch(database, /schemaVersion:\s*12/);
});
