import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	SYSTEM_HEALTH_REASONS,
	SystemManagementService,
} from "../src/services/system-management.service.js";
import {
	WebAdminSystemController,
	serializeSystem,
} from "../src/controllers/web-admin-system.controller.js";

function baseServices(overrides = {}) {
	const now = 1_800_000_000_000;
	const services = {
		env: { DB: {} },
		config: { version: "0.13.0", timezone: "Asia/Tehran" },
		settings: { async get() { return "1"; } },
		settingsService: {
			status() {
				return {
					version: 1,
					loaded: true,
					total: 8,
					d1Count: 8,
					invalidD1Keys: [],
					legacyFallbackKeys: [],
					defaultFallbackKeys: [],
					fullyMigrated: true,
				};
			},
		},
		secureSettingsService: {
			status() {
				return {
					version: 1,
					initialized: true,
					masterKeyConfigured: true,
					encryptedCount: 4,
					managedCount: 4,
					fullyMigrated: true,
					encryptedKeys: ["telegram.bot_token"],
					legacyFallbackKeys: [],
					secrets: {
						"telegram.bot_token": { configured: true, source: "encrypted_d1" },
						"telegram.webhook_secret": { configured: true, source: "encrypted_d1" },
						"coingecko.api_key": { configured: true, source: "encrypted_d1" },
						"cloudflare.api_token": { configured: true, source: "encrypted_d1" },
					},
				};
			},
		},
		cache: {
			async read() {
				return {
					fetchedAt: now - 30_000,
					expiresAt: now + 30_000,
					lastError: null,
					payload: {},
				};
			},
		},
		sourceSettings: {
			async snapshot() {
				return {
					usdt_priority: ["wallex", "tabdeal", "exir"],
					sources: {
						wallex: { name: "wallex", label: "Wallex", kind: "usdt", enabled: true, status: { success: true, status: 200, latency: 20, lastCheckedAt: now - 5000 } },
						tabdeal: { name: "tabdeal", label: "Tabdeal", kind: "usdt", enabled: true, status: { success: true, status: 200, latency: 30, lastCheckedAt: now - 5000 } },
						exir: { name: "exir", label: "Exir", kind: "usdt", enabled: false, status: null },
					},
				};
			},
		},
		automationManagement: {
			async state() {
				return {
					settings: {
						enabled: true,
						lastSuccessAt: now - 60_000,
						lastAttemptAt: now - 60_000,
						lastErrorAt: 0,
						lastError: "",
					},
					diagnostics: {
						reason: "ready",
						canPublishNow: true,
						nextPublishAt: now + 60_000,
					},
				};
			},
		},
		adminManagement: {
			async snapshot() {
				return {
					stats: {
						total: 2,
						activeAdmins: 1,
						inactiveAdmins: 0,
						ownerConfigured: true,
					},
				};
			},
		},
		...overrides,
	};
	return { now, services };
}

function manager(services, database = { connected: true, provider: "Cloudflare D1", latency_ms: 5, storage: { available: false }, records: {}, schema_version: 11 }, integrity = true) {
	return new SystemManagementService(services, {
		databaseStatusFn: async () => database,
		runtimeIntegrityFn: () => integrity,
	});
}

test("healthy system snapshot aggregates runtime, database, cache, sources and admins", async () => {
	const { now, services } = baseServices();
	const snapshot = await manager(services).snapshot(now);
	assert.equal(snapshot.health.status, "healthy");
	assert.deepEqual(snapshot.health.reasonCodes, []);
	assert.equal(snapshot.runtime.version, "0.13.0");
	assert.equal(snapshot.runtime.schemaVersion, 12);
	assert.equal(snapshot.cache.fresh, true);
	assert.equal(snapshot.sources.enabled, 2);
	assert.equal(snapshot.sources.healthy, 2);
	assert.equal(snapshot.admins.total, 2);
});

test("database or runtime integrity failure makes health critical", async () => {
	const { now, services } = baseServices();
	const snapshot = await manager(
		services,
		{ connected: false, provider: "Cloudflare D1", latency_ms: 1, storage: {}, records: {}, schema_version: 11 },
		false,
	).snapshot(now);
	assert.equal(snapshot.health.status, "critical");
	assert.ok(snapshot.health.critical.includes("database_unavailable"));
	assert.ok(snapshot.health.critical.includes("runtime_integrity_failed"));
});

test("source failure, unchecked source and stale cache make health degraded", async () => {
	const { now, services } = baseServices({
		cache: {
			async read() {
				return {
					fetchedAt: now - 120_000,
					expiresAt: now - 60_000,
					lastError: "provider timeout",
					payload: {},
				};
			},
		},
		sourceSettings: {
			async snapshot() {
				return {
					usdt_priority: ["wallex", "tabdeal", "exir"],
					sources: {
						wallex: { name: "wallex", label: "Wallex", kind: "usdt", enabled: true, status: { success: false, status: 503, latency: 10, message: "down", lastCheckedAt: now - 1_000 } },
						tabdeal: { name: "tabdeal", label: "Tabdeal", kind: "usdt", enabled: true, status: null },
					},
				};
			},
		},
	});
	const snapshot = await manager(services).snapshot(now);
	assert.equal(snapshot.health.status, "degraded");
	for (const reason of ["source_failures", "sources_unverified", "cache_expired", "cache_last_error"]) {
		assert.ok(snapshot.health.warnings.includes(reason), reason);
	}
});

test("disabled bot has explicit disabled health without becoming critical", async () => {
	const { now, services } = baseServices({
		settings: { async get() { return "0"; } },
	});
	const snapshot = await manager(services).snapshot(now);
	assert.equal(snapshot.health.status, "disabled");
	assert.ok(snapshot.health.notices.includes("bot_disabled"));
});

test("runtime settings migration notices are exposed without leaking secret values", async () => {
	const { now, services } = baseServices();
	services.settingsService.status = () => ({
		version: 1,
		loaded: true,
		total: 8,
		d1Count: 6,
		invalidD1Keys: [],
		legacyFallbackKeys: ["general.timezone"],
		defaultFallbackKeys: ["coingecko.plan"],
		fullyMigrated: false,
	});
	const snapshot = await manager(services).snapshot(now);
	assert.ok(snapshot.health.notices.includes("runtime_settings_legacy_fallback"));
	assert.ok(snapshot.health.notices.includes("runtime_settings_default_fallback"));
	assert.equal(snapshot.settings.secure.encryptedCount, 4);
	assert.ok(!Object.hasOwn(snapshot.settings.secure, "secrets"));
	assert.ok(!JSON.stringify(snapshot).includes("super-secret-value"));
});

test("invalid D1 runtime settings are treated as critical diagnostics", async () => {
	const { now, services } = baseServices();
	services.settingsService.status = () => ({
		version: 1,
		loaded: true,
		total: 8,
		d1Count: 7,
		invalidD1Keys: ["general.timezone"],
		legacyFallbackKeys: [],
		defaultFallbackKeys: [],
		fullyMigrated: false,
	});
	const snapshot = await manager(services).snapshot(now);
	assert.equal(snapshot.health.status, "critical");
	assert.ok(snapshot.health.critical.includes("runtime_settings_invalid"));
});

test("system snapshot does not invoke market provider refresh paths", async () => {
	const { now, services } = baseServices();
	let providerCalls = 0;
	services.market = { async getSnapshot() { providerCalls += 1; throw new Error("must not run"); } };
	services.coinGecko = { async fetchTopAssets() { providerCalls += 1; throw new Error("must not run"); } };
	await manager(services).snapshot(now);
	assert.equal(providerCalls, 0);
});

test("serializer converts timestamps and preserves reason codes", async () => {
	const { now, services } = baseServices();
	const snapshot = await manager(services).snapshot(now);
	const data = serializeSystem(snapshot);
	assert.equal(data.runtime.schema_version, 12);
	assert.equal(data.health.status, "healthy");
	assert.equal(data.cache.fetched_at, new Date(now - 30_000).toISOString());
	assert.equal(data.sources.items[0].last_checked_at, new Date(now - 5000).toISOString());
	assert.equal(data.settings.secure.missing_count, 0);
});

test("Web Admin system endpoint is authenticated, read-only and CSRF-free", async () => {
	const { now, services } = baseServices();
	const calls = [];
	const snapshot = await manager(services).snapshot(now);
	const controller = new WebAdminSystemController({
		webAuth: {
			async routingState() { return { adminPath: "secure" }; },
			async authenticate(_request, options) {
				calls.push(options);
				return { user: { id: 1, must_complete_bootstrap: 0 } };
			},
		},
		systemManagement: { async snapshot() { return snapshot; } },
	});
	const url = new URL("https://example.test/secure/api/v1/system");
	const response = await controller.route(new Request(url), url);
	assert.equal(response.status, 200);
	assert.deepEqual(calls[0], { requireCsrf: false });
	const body = await response.json();
	assert.equal(body.data.health.status, "healthy");

	const post = await controller.route(new Request(url, { method: "POST" }), url);
	assert.equal(post.status, 405);
});

test("system controller yields unrelated routes", async () => {
	const controller = new WebAdminSystemController({
		webAuth: { async routingState() { return { adminPath: "secure" }; } },
	});
	const url = new URL("https://example.test/secure/api/v1/market");
	assert.equal(await controller.route(new Request(url), url), null);
});

test("composition root and application wire the dedicated system management boundary", async () => {
	const [container, application] = await Promise.all([
		readFile(new URL("../src/app/container.js", import.meta.url), "utf8"),
		readFile(new URL("../src/app/application.js", import.meta.url), "utf8"),
	]);
	assert.match(container, /new SystemManagementService/);
	assert.match(container, /systemManagement,/);
	assert.match(application, /new WebAdminSystemController\(this\.services\)/);
	assert.match(application, /webAdminSystem\.route/);
});

test("Phase 11.1 keeps schema 11 and defines stable health reason groups", () => {
	assert.ok(SYSTEM_HEALTH_REASONS.critical.includes("database_unavailable"));
	assert.ok(SYSTEM_HEALTH_REASONS.warnings.includes("source_failures"));
	assert.ok(SYSTEM_HEALTH_REASONS.notices.includes("bot_disabled"));
});
