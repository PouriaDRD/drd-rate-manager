import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MarketSources } from "../src/market/market-sources.js";
import {
	DEFAULT_USDT_PRIORITY,
	SourceSettingsService,
	normalizeUsdtPriority,
} from "../src/services/source-settings.service.js";

class FakeSettings {
	constructor(values = {}) {
		this.values = { ...values };
	}
	async get(key, fallback = null) {
		return this.values[key] ?? fallback;
	}
	async getMany(keys) {
		return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, this.values[key]]));
	}
	async set(key, value) {
		this.values[key] = String(value);
	}
}

class FakeStatuses {
	constructor() {
		this.saved = [];
	}
	async all() {
		return Object.fromEntries(
			["wallex", "tabdeal", "exir", "coingecko", "wallgold"].map((name) => [name, {
				success: name === "tabdeal",
				status: name === "tabdeal" ? 200 : null,
				latency: name === "tabdeal" ? 30 : null,
				message: null,
				price: name === "tabdeal" ? 62000 : null,
				lastCheckedAt: 0,
			}]),
		);
	}
	async save(name, status) {
		this.saved.push({ name, status });
	}
	async saveMany(map) {
		for (const [name, status] of Object.entries(map)) await this.save(name, status);
	}
}

test("source settings default to every provider enabled and stable USDT priority", async () => {
	const service = new SourceSettingsService(new FakeSettings(), new FakeStatuses());
	const snapshot = await service.snapshot();
	assert.deepEqual(snapshot.usdt_priority, DEFAULT_USDT_PRIORITY);
	assert.equal(Object.keys(snapshot.sources).length, 5);
	assert.equal(Object.values(snapshot.sources).every((source) => source.enabled), true);
});

test("source settings persist toggles and validate USDT priority permutations", async () => {
	const settings = new FakeSettings();
	const service = new SourceSettingsService(settings, new FakeStatuses());
	assert.equal(await service.setEnabled("wallex", false), false);
	assert.equal(await service.isEnabled("wallex"), false);
	assert.deepEqual(await service.setUsdtPriority(["exir", "wallex", "tabdeal"]), ["exir", "wallex", "tabdeal"]);
	assert.equal(settings.values.usdt_source_priority, "exir,wallex,tabdeal");
	await assert.rejects(() => service.setUsdtPriority(["wallex", "wallex", "exir"]), /exactly once/);
});

test("priority normalization fails safe to the default route", () => {
	assert.deepEqual(normalizeUsdtPriority("exir,tabdeal,wallex"), ["exir", "tabdeal", "wallex"]);
	assert.deepEqual(normalizeUsdtPriority("wallex,wallex"), DEFAULT_USDT_PRIORITY);
});

test("USDT runtime follows D1 priority and skips disabled sources", async () => {
	const requested = [];
	const settings = new FakeSettings({
		"source.exir.enabled": "0",
		"source.tabdeal.enabled": "1",
		"source.wallex.enabled": "1",
		usdt_source_priority: "exir,tabdeal,wallex",
	});
	const statuses = new FakeStatuses();
	const sourceSettings = new SourceSettingsService(settings, statuses);
	const http = {
		async fetch(url) {
			requested.push(url);
			return {
				ok: true,
				status: 200,
				async json() { return { asks: [["61234"]] }; },
			};
		},
		async sourceError() { return "error"; },
	};
	const env = {
		WALLEX_API_URL: "https://test/wallex",
		TABDEAL_API_URL: "https://test/tabdeal",
		EXIR_API_URL: "https://test/exir",
	};
	const sources = new MarketSources(env, http, statuses, null, sourceSettings);
	const result = await sources.resolveUsdt();
	assert.equal(result.source, "tabdeal");
	assert.equal(result.fallbackLevel, 1);
	assert.deepEqual(requested, ["https://test/tabdeal"]);
});

test("full USDT check records disabled providers without making their network call", async () => {
	const requested = [];
	const settings = new FakeSettings({
		"source.wallex.enabled": "0",
		"source.tabdeal.enabled": "1",
		"source.exir.enabled": "0",
	});
	const statuses = new FakeStatuses();
	const sourceSettings = new SourceSettingsService(settings, statuses);
	const sources = new MarketSources(
		{ TABDEAL_API_URL: "https://test/tabdeal" },
		{
			async fetch(url) {
				requested.push(url);
				return { ok: true, status: 200, async json() { return { asks: [["60000"]] }; } };
			},
			async sourceError() { return "error"; },
		},
		statuses,
		null,
		sourceSettings,
	);
	const result = await sources.checkAllUsdt();
	assert.equal(result.wallex.message, "Source disabled");
	assert.equal(result.exir.message, "Source disabled");
	assert.equal(result.tabdeal.success, true);
	assert.deepEqual(requested, ["https://test/tabdeal"]);
});

test("web admin exposes authenticated source and asset management APIs", async () => {
	const source = await readFile(new URL("../src/controllers/web-admin-data.controller.js", import.meta.url), "utf8");
	assert.match(source, /api\/v1\/sources\/usdt-priority/);
	assert.match(source, /sources\/\(\[a-z0-9_-/);
	assert.match(source, /api\/v1\/assets\/refresh/);
	assert.match(source, /setEnabled/);
	assert.match(source, /#testSource/);
	assert.match(source, /requireCsrf: mutation/);
});

test("frontend has real Sources and Assets views with safe DOM rendering", async () => {
	const [html, app, api] = await Promise.all([
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/api.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /id="sources-view"/);
	assert.match(html, /id="assets-view"/);
	assert.match(html, /id="usdt-priority-list"/);
	assert.match(html, /id="asset-search"/);
	assert.match(app, /renderSources/);
	assert.match(app, /renderAssets/);
	assert.match(app, /createElement/);
	assert.doesNotMatch(app, /sourcesList\.innerHTML|assetsList\.innerHTML/);
	assert.match(api, /updateUsdtPriority/);
	assert.match(api, /refreshAssets/);
});

test("Telegram source management reads the same D1 settings and exposes toggles", async () => {
	const [core, settings] = await Promise.all([
		readFile(new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url), "utf8"),
		readFile(new URL("../src/controllers/telegram/telegram-settings.methods.js", import.meta.url), "utf8"),
	]);
	assert.match(core, /sources:toggle:/);
	assert.match(core, /sources:priority:rotate/);
	assert.match(settings, /sourceSettings\.snapshot/);
	assert.match(settings, /sourceSettings/);
});

test("composition root shares one SourceSettingsService with market runtime", async () => {
	const source = await readFile(new URL("../src/app/container.js", import.meta.url), "utf8");
	assert.match(source, /new SourceSettingsService\(settings, statuses\)/);
	assert.match(source, /new MarketSources\(runtimeEnv, http, statuses, config, sourceSettings\)/);
	assert.match(source, /coinGecko, sourceSettings\)/);
});

test("asset repository supports explicit idempotent enabled state", async () => {
	const source = await readFile(new URL("../src/repositories/asset.repository.js", import.meta.url), "utf8");
	assert.match(source, /async setEnabled\(coinId, enabled\)/);
	assert.match(source, /is_enabled = \?/);
});
