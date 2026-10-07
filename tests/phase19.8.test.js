import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GOLD_SOURCE_NAMES, USDT_SOURCE_PRIORITY } from "../src/config/app.js";
import {
	RUNTIME_SETTING_DEFINITIONS,
	RUNTIME_SETTING_MAP,
} from "../src/config/runtime-settings.js";
import { telegram_coreMethods } from "../src/controllers/telegram/telegram-core.methods.js";
import { adminUiResponse } from "../src/http/admin-responses.js";
import { normalizeCommand } from "../src/telegram/ui.js";

const EXPECTED_PROVIDER_SETTINGS = Object.freeze({
	wallex: ["providers.wallex_api_url", "WALLEX_API_URL"],
	tabdeal: ["providers.tabdeal_api_url", "TABDEAL_API_URL"],
	exir: ["providers.exir_api_url", "EXIR_API_URL"],
	bitpin: ["providers.bitpin_api_url", "BITPIN_API_URL"],
	nobitex: ["providers.nobitex_api_url", "NOBITEX_API_URL"],
	ompfinex: ["providers.ompfinex_api_url", "OMPFINEX_API_URL"],
	ramzinex: ["providers.ramzinex_api_url", "RAMZINEX_API_URL"],
	wallgold: ["providers.wallgold_api_url", "WALLGOLD_API_URL"],
	technogold: ["providers.technogold_api_url", "TECHNOGOLD_API_URL"],
	melligold: ["providers.melligold_api_url", "MELLIGOLD_API_URL"],
	talasea: ["providers.talasea_api_url", "TALASEA_API_URL"],
	milli: ["providers.milli_api_url", "MILLI_API_URL"],
	gerami: ["providers.gerami_api_url", "GERAMI_API_URL"],
});

function telegramHarness({ input = null } = {}) {
	const calls = {
		send: [],
		menu: 0,
		start: 0,
		help: 0,
		tokenInput: 0,
		addAdminInput: 0,
		requiredChannelInput: 0,
		clears: 0,
		sync: 0,
	};

	const context = {
		s: {
			telegram: {
				syncInterface() {
					calls.sync += 1;
				},
				async sendMessage(...args) {
					calls.send.push(args);
				},
			},
			admins: {
				async resolve() {
					return { role: "owner", enabled: true };
				},
				async touchProfile() {},
			},
			adminInput: {
				async get() {
					return input;
				},
				async clear() {
					calls.clears += 1;
				},
			},
			settings: {
				async get() {
					return "1";
				},
			},
		},
		async _enforceRequiredMembership() {
			return true;
		},
		async _sendStart() {
			calls.start += 1;
		},
		async _sendMenu() {
			calls.menu += 1;
		},
		async _sendHelp() {
			calls.help += 1;
		},
		async _handleApiTokenNameInput() {
			calls.tokenInput += 1;
		},
		async _handleAddAdminInput() {
			calls.addAdminInput += 1;
		},
		async _handleRequiredChannelInput() {
			calls.requiredChannelInput += 1;
		},
		_disabledText() {
			return "disabled";
		},
		_tg() {
			return "translated";
		},
	};

	return { context, calls };
}

function message(text) {
	return {
		text,
		chat: { id: 100 },
		from: { id: 200, username: "owner" },
	};
}

test("Phase 19.8 provider catalog covers every USDT and gold source exactly once", () => {
	const expectedSources = [...USDT_SOURCE_PRIORITY, ...GOLD_SOURCE_NAMES];
	assert.equal(expectedSources.length, 13);
	assert.equal(new Set(expectedSources).size, expectedSources.length);
	assert.deepEqual(
		new Set(Object.keys(EXPECTED_PROVIDER_SETTINGS)),
		new Set(expectedSources),
	);

	const providerDefinitions = RUNTIME_SETTING_DEFINITIONS.filter(
		(item) => item.category === "providers",
	);
	assert.equal(providerDefinitions.length, 13);
	assert.equal(
		new Set(providerDefinitions.map((item) => item.key)).size,
		providerDefinitions.length,
	);
	assert.equal(
		new Set(providerDefinitions.map((item) => item.legacyEnvKey)).size,
		providerDefinitions.length,
	);

	for (const source of expectedSources) {
		const [settingKey, envKey] = EXPECTED_PROVIDER_SETTINGS[source];
		const definition = RUNTIME_SETTING_MAP.get(settingKey);
		assert.ok(definition, `${source} runtime setting is missing`);
		assert.equal(definition.type, "url");
		assert.equal(definition.category, "providers");
		assert.equal(definition.legacyEnvKey, envKey);
		assert.match(String(definition.defaultValue), /^https?:\/\//);
	}
});

test("Phase 19.8 provider configuration is documented for all thirteen sources", async () => {
	const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
	for (const [source, [, envKey]] of Object.entries(EXPECTED_PROVIDER_SETTINGS)) {
		assert.match(env, new RegExp(`^${envKey}=`, "m"), `${source} missing from .env.example`);
	}
});

test("Phase 19.8 Config facade exposes every provider URL used by MarketSources", async () => {
	const [configSource, marketSource] = await Promise.all([
		readFile(new URL("../src/config/config.js", import.meta.url), "utf8"),
		readFile(new URL("../src/market/market-sources.js", import.meta.url), "utf8"),
	]);

	const getters = {
		wallex: "wallexApiUrl",
		tabdeal: "tabdealApiUrl",
		exir: "exirApiUrl",
		bitpin: "bitpinApiUrl",
		nobitex: "nobitexApiUrl",
		ompfinex: "ompfinexApiUrl",
		ramzinex: "ramzinexApiUrl",
		wallgold: "wallGoldApiUrl",
		technogold: "technoGoldApiUrl",
		melligold: "melliGoldApiUrl",
		talasea: "talaseaApiUrl",
		milli: "milliApiUrl",
		gerami: "geramiApiUrl",
	};

	for (const source of [...USDT_SOURCE_PRIORITY, ...GOLD_SOURCE_NAMES]) {
		const getter = getters[source];
		assert.match(configSource, new RegExp(`get ${getter}\\(\\)`), `${source} Config getter missing`);
		assert.ok(
			marketSource.includes(`this.config?.${getter}`),
			`${source} MarketSources does not resolve through Config`,
		);
	}
});

test("Phase 19.8 private Web Admin document and assets are never cacheable", async () => {
	for (const document of [true, false]) {
		const response = adminUiResponse(
			new Response("asset", {
				headers: {
					"Content-Type": document ? "text/html" : "text/javascript",
					"Cache-Control": "public, max-age=99999",
				},
			}),
			{ document },
		);

		const cache = response.headers.get("Cache-Control") || "";
		assert.match(cache, /no-store/);
		assert.match(cache, /no-cache/);
		assert.match(cache, /must-revalidate/);
		assert.match(cache, /private/);
		assert.doesNotMatch(cache, /max-age=[1-9]/);
		assert.equal(response.headers.get("Pragma"), "no-cache");
		assert.equal(response.headers.get("Expires"), "0");
	}
});

test("Phase 19.8 command parser ignores ordinary text and preserves slash commands", () => {
	assert.equal(normalizeCommand("Test"), "");
	assert.equal(normalizeCommand("سلام"), "");
	assert.equal(normalizeCommand("  hello world  "), "");
	assert.equal(normalizeCommand("/menu"), "/menu");
	assert.equal(normalizeCommand("/MENU"), "/menu");
	assert.equal(normalizeCommand("/menu@DRDRateManagerBot"), "/menu");
	assert.equal(normalizeCommand("/random"), "/random");
});

test("Phase 19.8 Telegram ordinary text is a no-op outside pending input flows", async () => {
	const { context, calls } = telegramHarness();
	await telegram_coreMethods._message.call(context, message("Test"));

	assert.equal(calls.menu, 0);
	assert.equal(calls.start, 0);
	assert.equal(calls.help, 0);
	assert.equal(calls.send.length, 0);
	assert.equal(calls.clears, 0);
});

test("Phase 19.8 Telegram unknown slash commands are ignored and do not open the menu", async () => {
	const { context, calls } = telegramHarness();
	await telegram_coreMethods._message.call(context, message("/random"));

	assert.equal(calls.menu, 0);
	assert.equal(calls.start, 0);
	assert.equal(calls.help, 0);
	assert.equal(calls.send.length, 0);
	assert.equal(calls.clears, 0);
});

test("Phase 19.8 pending API token name consumes normal text instead of opening the menu", async () => {
	const { context, calls } = telegramHarness({
		input: { action: "api_token_name", type: "market", expiresAt: 0 },
	});
	await telegram_coreMethods._message.call(context, message("Test"));

	assert.equal(calls.tokenInput, 1);
	assert.equal(calls.menu, 0);
	assert.equal(calls.clears, 0);
});

test("Phase 19.8 unknown slash command does not consume or cancel a pending API token name", async () => {
	const { context, calls } = telegramHarness({
		input: { action: "api_token_name", type: "market", expiresAt: 0 },
	});
	await telegram_coreMethods._message.call(context, message("/random"));

	assert.equal(calls.tokenInput, 0);
	assert.equal(calls.menu, 0);
	assert.equal(calls.clears, 0);
});

test("Phase 19.8 supported Telegram commands still work and cancel token-name input safely", async () => {
	const { context, calls } = telegramHarness({
		input: { action: "api_token_name", type: "market", expiresAt: 0 },
	});
	await telegram_coreMethods._message.call(context, message("/menu"));

	assert.equal(calls.menu, 1);
	assert.equal(calls.clears, 1);
	assert.equal(calls.tokenInput, 0);
	assert.equal(calls.sync, 1);
});

test("Phase 19.8 pending add-admin and required-channel inputs accept plain text", async () => {
	{
		const { context, calls } = telegramHarness({ input: { action: "add_admin" } });
		await telegram_coreMethods._message.call(context, message("401632051"));
		assert.equal(calls.addAdminInput, 1);
		assert.equal(calls.menu, 0);
	}
	{
		const { context, calls } = telegramHarness({ input: { action: "required_channel_add" } });
		await telegram_coreMethods._message.call(context, message("@DRDNetwork"));
		assert.equal(calls.requiredChannelInput, 1);
		assert.equal(calls.menu, 0);
	}
});

test("Phase 19.8 foundation keeps APP_MASTER_KEY out of runtime/provider catalogs", async () => {
	const [runtime, env] = await Promise.all([
		readFile(new URL("../src/config/runtime-settings.js", import.meta.url), "utf8"),
		readFile(new URL("../.env.example", import.meta.url), "utf8"),
	]);

	assert.equal(RUNTIME_SETTING_MAP.has("app.master_key"), false);
	assert.doesNotMatch(runtime, /APP_MASTER_KEY/);
	assert.match(env, /PERMANENT INFRASTRUCTURE SECRET/);
	assert.match(env, /^APP_MASTER_KEY=$/m);
});

test("Phase 19.8A changes neither schema nor application version", async () => {
	const source = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(source, /version:\s*"0\.2\.0"/);
	assert.match(source, /schemaVersion:\s*13/);
});
