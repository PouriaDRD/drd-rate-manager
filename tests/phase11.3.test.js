import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { telegram_systemMethods } from "../src/controllers/telegram/telegram-system.methods.js";

const message = { chat: { id: 1 }, message_id: 2 };

function systemSnapshot(overrides = {}) {
	const base = {
		health: { status: "healthy", reasonCodes: [], critical: [], warnings: [], notices: [] },
		runtime: {
			version: "0.13.0",
			schemaVersion: 11,
			timezone: "Asia/Tehran",
			integrity: true,
			botEnabled: true,
		},
		database: {
			connected: true,
			provider: "Cloudflare D1",
			latency_ms: 12,
			storage: {
				available: true,
				bar: "████░░░░░░",
				percent: 40,
				used_mb: 40,
				total_mb: 100,
				remaining_mb: 60,
			},
			records: { settings: 8, automation_runs: 4 },
			schema_version: 11,
		},
		cache: {
			present: true,
			fresh: true,
			expired: false,
			fetchedAt: 1000,
			expiresAt: 2000,
			ageSeconds: 10,
			ttlRemainingSeconds: 20,
			lastError: null,
		},
		automation: {
			enabled: true,
			reason: "ready",
			canPublishNow: true,
			nextPublishAt: 2_000_000,
			lastSuccessAt: 1_000_000,
			lastAttemptAt: 1_000_000,
			lastErrorAt: 0,
			lastError: null,
		},
		sources: {
			total: 5,
			enabled: 4,
			healthy: 3,
			failed: 1,
			unchecked: 0,
			usdtPriority: ["wallex", "tabdeal", "exir"],
			items: [],
		},
		admins: {
			total: 3,
			activeAdmins: 2,
			inactiveAdmins: 0,
			ownerConfigured: true,
		},
		settings: {
			runtime: {
				total: 8,
				d1Count: 8,
				invalidD1Keys: [],
				legacyFallbackKeys: [],
				defaultFallbackKeys: [],
				fullyMigrated: true,
			},
			secure: {
				encryptedCount: 4,
				managedCount: 4,
				fullyMigrated: true,
				legacyFallbackCount: 0,
				missingCount: 0,
			},
		},
	};
	return {
		...base,
		...overrides,
		health: { ...base.health, ...(overrides.health || {}) },
		runtime: { ...base.runtime, ...(overrides.runtime || {}) },
		database: { ...base.database, ...(overrides.database || {}) },
		cache: { ...base.cache, ...(overrides.cache || {}) },
		automation: { ...base.automation, ...(overrides.automation || {}) },
		sources: { ...base.sources, ...(overrides.sources || {}) },
		admins: { ...base.admins, ...(overrides.admins || {}) },
		settings: {
			runtime: { ...base.settings.runtime, ...(overrides.settings?.runtime || {}) },
			secure: { ...base.settings.secure, ...(overrides.settings?.secure || {}) },
		},
	};
}

function controller({ language = "en", snapshot = systemSnapshot() } = {}) {
	const edits = [];
	let snapshotCalls = 0;
	const ctx = {
		s: {
			config: { timezone: "UTC" },
			systemManagement: {
				async snapshot() {
					snapshotCalls += 1;
					return snapshot;
				},
			},
			telegram: {
				async editMessage(...args) {
					edits.push(args);
					return args;
				},
			},
		},
		_tgLanguage() { return language; },
		_tg(key) { return key; },
		...telegram_systemMethods,
	};
	return { ctx, edits, getSnapshotCalls: () => snapshotCalls };
}

test("Telegram System reads exactly one shared SystemManagementService snapshot", async () => {
	const { ctx, edits, getSnapshotCalls } = controller();
	await ctx._showSystem(message);
	assert.equal(getSnapshotCalls(), 1);
	assert.match(edits[0][2], /System status/);
	assert.match(edits[0][2], /Healthy/);
	assert.match(edits[0][2], /3\/4/);
});

test("Telegram System renders the same critical health and reason codes as Web Admin", async () => {
	const { ctx, edits } = controller({
		snapshot: systemSnapshot({
			health: {
				status: "critical",
				reasonCodes: ["database_unavailable", "runtime_integrity_failed"],
			},
			runtime: { integrity: false },
			database: { connected: false },
		}),
	});
	await ctx._showSystem(message);
	assert.match(edits[0][2], /Critical/);
	assert.match(edits[0][2], /database_unavailable/);
	assert.match(edits[0][2], /runtime_integrity_failed/);
});

test("Telegram System has deterministic Persian health labels", async () => {
	const { ctx, edits } = controller({
		language: "fa",
		snapshot: systemSnapshot({
			health: { status: "degraded", reasonCodes: ["cache_expired"] },
		}),
	});
	await ctx._showSystem(message);
	assert.match(edits[0][2], /نیازمند توجه/);
	assert.match(edits[0][2], /کش بازار منقضی شده/);
});

test("Telegram System displays migration counts without exposing secure values", async () => {
	const { ctx, edits } = controller();
	await ctx._showSystem(message);
	assert.match(edits[0][2], /8\/8 D1/);
	assert.match(edits[0][2], /4\/4 encrypted/);
	assert.doesNotMatch(edits[0][2], /bot_token/i);
	assert.doesNotMatch(edits[0][2], /api_token/i);
});

test("Telegram Database reads the same shared snapshot and renders D1 storage", async () => {
	const { ctx, edits, getSnapshotCalls } = controller();
	await ctx._showDatabase(message);
	assert.equal(getSnapshotCalls(), 1);
	assert.match(edits[0][2], /Cloudflare D1 connected/);
	assert.match(edits[0][2], /40\.00%/);
	assert.match(edits[0][2], /automation_runs/);
	assert.match(edits[0][2], /Schema: <code>11<\/code>/);
});

test("Telegram Database gracefully handles unavailable storage metrics", async () => {
	const { ctx, edits } = controller({
		snapshot: systemSnapshot({
			database: {
				storage: { available: false },
			},
		}),
	});
	await ctx._showDatabase(message);
	assert.match(edits[0][2], /Storage metrics unavailable/);
});

test("legacy Telegram system logic no longer imports direct health dependencies", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-system.methods.js", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /runtimeIntegrity/);
	assert.doesNotMatch(source, /databaseStatus/);
	assert.doesNotMatch(source, /parseBoolean/);
	assert.doesNotMatch(source, /market\.cacheTtlSeconds/);
	assert.doesNotMatch(source, /automation\.getSettings/);
	assert.match(source, /systemManagement\.snapshot/);
});

test("Telegram System screen does not trigger market or provider refresh operations", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-system.methods.js", import.meta.url),
		"utf8",
	);
	const block = source.slice(
		source.indexOf("async _showSystem(message)"),
		source.indexOf("async _showAdmins(message, admin)"),
	);
	assert.doesNotMatch(block, /forceRefresh/);
	assert.doesNotMatch(block, /fetchTopAssets/);
	assert.doesNotMatch(block, /testSource/);
	assert.doesNotMatch(block, /getSnapshot\(\{ forceRefresh/);
});

test("existing Telegram callbacks still route System and Database screens", async () => {
	const core = await readFile(
		new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url),
		"utf8",
	);
	assert.match(core, /data === "system:home".*_showSystem\(message\)/);
	assert.match(core, /data === "database:home".*_showDatabase\(message\)/);
});

test("Phase 11.2 Web Admin System assets remain present after Telegram sync", async () => {
	const [html, systemJs] = await Promise.all([
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /id="system-view"/);
	assert.match(systemJs, /bridge\(\)\.system\(\)/);
});

test("Phase 10 Telegram admin management remains in the same controller after System sync", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-system.methods.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /async _showAdmins\(message, admin\)/);
	assert.match(source, /adminManagement\.snapshot/);
	assert.match(source, /adminManagement\.setEnabled/);
	assert.match(source, /adminManagement\.remove/);
});

test("health status icons cover healthy, degraded, disabled and critical states", () => {
	const { ctx } = controller();
	assert.equal(ctx._systemHealthIcon("healthy"), "🟢");
	assert.equal(ctx._systemHealthIcon("degraded"), "🟡");
	assert.equal(ctx._systemHealthIcon("disabled"), "⚪");
	assert.equal(ctx._systemHealthIcon("critical"), "🔴");
});
