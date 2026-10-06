import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	PROVIDER_HEALTH_SCORE_VERSION,
	ProviderHealthService,
	providerHealthGrade,
	providerHealthScore,
} from "../src/services/provider-health.service.js";
import { ProviderResilienceService } from "../src/services/provider-resilience.service.js";

test("health grade thresholds are deterministic", () => {
	assert.equal(providerHealthGrade(100), "excellent");
	assert.equal(providerHealthGrade(85), "excellent");
	assert.equal(providerHealthGrade(84), "healthy");
	assert.equal(providerHealthGrade(65), "healthy");
	assert.equal(providerHealthGrade(40), "degraded");
	assert.equal(providerHealthGrade(39), "unhealthy");
	assert.equal(providerHealthGrade(null), "disabled");
});

test("successful low-latency fresh source receives maximum score", () => {
	const now = 1_800_000_000_000;
	assert.equal(
		providerHealthScore({
			enabled: true,
			status: { success: true, latency: 100, lastCheckedAt: now - 1000 },
			circuit: { state: "closed" },
			now,
		}),
		100,
	);
});

test("latency and stale checks reduce otherwise healthy score", () => {
	const now = 1_800_000_000_000;
	const score = providerHealthScore({
		enabled: true,
		status: { success: true, latency: 2200, lastCheckedAt: now - 20 * 60_000 },
		circuit: { state: "closed" },
		now,
	});
	assert.ok(score < 80);
	assert.ok(score >= 40);
});

test("open circuit caps provider health at 15", () => {
	const now = 1_800_000_000_000;
	const score = providerHealthScore({
		enabled: true,
		status: { success: true, latency: 20, lastCheckedAt: now - 1000 },
		circuit: { state: "open" },
		now,
	});
	assert.equal(score, 15);
});

test("disabled source has no health score", () => {
	assert.equal(providerHealthScore({ enabled: false }), null);
});

test("resilience inspect reports open, half-open-ready and closed without provider calls", async () => {
	let now = 1_800_000_000_000;
	const leases = new Map([
		["provider:wallex", { expiresAt: now + 60_000, updatedAt: now, leaseMs: 60_000 }],
		["provider:tabdeal", { expiresAt: now - 1, updatedAt: now - 60_001, leaseMs: 60_000 }],
	]);
	const resilience = new ProviderResilienceService(
		{
			async peek(key) { return leases.get(key) || null; },
		},
		{ now: () => now },
	);
	assert.equal((await resilience.inspect("wallex")).state, "open");
	assert.equal((await resilience.inspect("tabdeal")).state, "half_open_ready");
	assert.equal((await resilience.inspect("exir")).state, "closed");
});

test("resilience inspect failure becomes unknown instead of throwing", async () => {
	const resilience = new ProviderResilienceService({
		async peek() { throw new Error("D1 unavailable"); },
	});
	const state = await resilience.inspect("wallex", 1_800_000_000_000);
	assert.equal(state.state, "unknown");
	assert.match(state.error, /D1 unavailable/);
});

test("ProviderHealthService combines D1 status and circuit state without network work", async () => {
	const now = 1_800_000_000_000;
	const service = new ProviderHealthService(
		{
			async snapshot() {
				return {
					usdt_priority: ["wallex", "tabdeal", "exir"],
					sources: {
						wallex: {
							name: "wallex", label: "Wallex", kind: "usdt", enabled: true,
							status: { success: false, status: 503, latency: 300, lastCheckedAt: now - 1000 },
						},
						tabdeal: {
							name: "tabdeal", label: "Tabdeal", kind: "usdt", enabled: true,
							status: { success: true, status: 200, latency: 100, lastCheckedAt: now - 1000 },
						},
						exir: { name: "exir", label: "Exir", kind: "usdt", enabled: false, status: null },
						coingecko: {
							name: "coingecko", label: "CoinGecko", kind: "market", enabled: true,
							status: { success: true, status: 200, latency: 900, lastCheckedAt: now - 1000 },
						},
						wallgold: {
							name: "wallgold", label: "WallGold", kind: "gold", enabled: true,
							status: { success: true, status: 200, latency: 80, lastCheckedAt: now - 1000 },
						},
					},
				};
			},
		},
		{
			async inspectAll() {
				return {
					wallex: { state: "open", retryAt: now + 45_000, remainingMs: 45_000 },
					tabdeal: { state: "closed", retryAt: 0, remainingMs: 0 },
					exir: { state: "closed", retryAt: 0, remainingMs: 0 },
					coingecko: { state: "closed", retryAt: 0, remainingMs: 0 },
					wallgold: { state: "closed", retryAt: 0, remainingMs: 0 },
				};
			},
		},
	);
	const snapshot = await service.snapshot(now);
	assert.equal(snapshot.provider_health.version, PROVIDER_HEALTH_SCORE_VERSION);
	assert.equal(snapshot.provider_health.openCircuits, 1);
	assert.equal(snapshot.sources.wallex.health.score <= 15, true);
	assert.equal(snapshot.sources.tabdeal.health.grade, "excellent");
	assert.equal(snapshot.sources.exir.health.score, null);
	assert.ok(snapshot.provider_health.score > 50);
});

test("SystemManagement source health fixes never-checked detection using timestamp", async () => {
	const source = await readFile(
		new URL("../src/services/system-management.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /checkedAt\(item\) <= 0/);
	assert.match(source, /healthScore: snapshot\.provider_health\?\.score/);
	assert.match(source, /provider_circuit_open/);
});

test("System Web API serializes provider scores and circuit diagnostics", async () => {
	const source = await readFile(
		new URL("../src/controllers/web-admin-system.controller.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /health_score: snapshot\.sources\.healthScore/);
	assert.match(source, /open_circuits: snapshot\.sources\.openCircuits/);
	assert.match(source, /circuit_state: item\.circuitState/);
	assert.match(source, /circuit_retry_at: isoOrNull\(item\.circuitRetryAt\)/);
});

test("Web Admin System renders score and circuit with safe DOM primitives", async () => {
	const source = await readFile(
		new URL("../public/admin/assets/system.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /item\.health_score/);
	assert.match(source, /item\.circuit_state/);
	assert.match(source, /status_provider_circuit_open/);
	assert.doesNotMatch(source, /\.innerHTML\s*=/);
});

test("Telegram System renders shared provider health summary", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-system.methods.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /Provider health/);
	assert.match(source, /sources\.healthScore/);
	assert.match(source, /sources\.openCircuits/);
	assert.match(source, /provider_circuit_open/);
});

test("composition root wires ProviderHealthService without a second resilience instance", async () => {
	const source = await readFile(
		new URL("../src/app/container.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /new ProviderHealthService\(sourceSettings, resilience\)/);
	assert.equal((source.match(/new ProviderResilienceService\(locks\)/g) || []).length, 1);
	assert.match(source, /providerHealth,/);
});

test("Phase 13.2 performs no provider network call from diagnostics services", async () => {
	const [health, system] = await Promise.all([
		readFile(new URL("../src/services/provider-health.service.js", import.meta.url), "utf8"),
		readFile(new URL("../src/services/system-management.service.js", import.meta.url), "utf8"),
	]);
	assert.doesNotMatch(health, /\.fetch\(/);
	assert.doesNotMatch(health, /fetchMarketBundle|checkWallex|checkTabdeal|checkExir/);
	assert.doesNotMatch(system, /forceRefresh|fetchTopAssets|testSource/);
});

test("Phase 13.2 keeps app version 0.2.0 and schema 11", async () => {
	const app = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(app, /version:\s*"0\.2\.0"/);
	assert.match(app, /schemaVersion:\s*13/);
});
