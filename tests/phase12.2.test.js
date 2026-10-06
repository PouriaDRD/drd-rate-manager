import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	configurationMigrationReadiness,
	configurationOwnershipSnapshot,
} from "../src/config/config-ownership.js";
import { serializeSystem } from "../src/controllers/web-admin-system.controller.js";

test("complete runtime and encrypted-secret coverage is safe for legacy ENV removal", () => {
	const readiness = configurationMigrationReadiness(
		{
			fullyMigrated: true,
			invalidD1Keys: [],
			legacyFallbackKeys: [],
			defaultFallbackKeys: [],
		},
		{
			managedCount: 4,
			encryptedCount: 4,
			legacyFallbackKeys: [],
			secrets: {
				a: { configured: true, source: "encrypted_d1" },
				b: { configured: true, source: "encrypted_d1" },
				c: { configured: true, source: "encrypted_d1" },
				d: { configured: true, source: "encrypted_d1" },
			},
		},
	);
	assert.equal(readiness.canRemoveAllLegacyEnv, true);
	assert.deepEqual(readiness.blockers, []);
});

test("missing managed secrets block secret ENV cleanup", () => {
	const readiness = configurationMigrationReadiness(
		{
			fullyMigrated: true,
			invalidD1Keys: [],
			legacyFallbackKeys: [],
			defaultFallbackKeys: [],
		},
		{
			managedCount: 4,
			encryptedCount: 3,
			legacyFallbackKeys: [],
			secrets: {
				"telegram.bot_token": { configured: false, source: "missing" },
				"telegram.webhook_secret": { configured: true, source: "encrypted_d1" },
			},
		},
	);
	assert.equal(readiness.secureReady, false);
	assert.equal(readiness.canRemoveLegacySecretEnv, false);
	assert.deepEqual(readiness.blockers[0], {
		code: "secure_settings_missing",
		keys: ["telegram.bot_token"],
	});
});

test("legacy secure fallback remains an explicit migration blocker", () => {
	const readiness = configurationMigrationReadiness(
		{
			fullyMigrated: true,
			invalidD1Keys: [],
			legacyFallbackKeys: [],
			defaultFallbackKeys: [],
		},
		{
			managedCount: 4,
			encryptedCount: 3,
			legacyFallbackKeys: ["coingecko.api_key"],
			secrets: {
				"coingecko.api_key": { configured: true, source: "legacy_env" },
			},
		},
	);
	assert.equal(readiness.canRemoveAllLegacyEnv, false);
	assert.equal(readiness.blockers[0].code, "secure_settings_legacy_fallback");
});

test("ownership metadata identifies permanent deployment and infrastructure ENV keys", () => {
	const ownership = configurationOwnershipSnapshot();
	assert.equal(ownership.valid, true);
	assert.deepEqual(ownership.identity.envKeys, ["APP_NAME", "APP_VERSION"]);
	assert.deepEqual(ownership.infrastructure.secretEnvKeys, ["APP_MASTER_KEY"]);
	assert.deepEqual(ownership.infrastructure.bindings, ["DB", "ASSETS"]);
});

test("SystemManagementService wires ownership and migration readiness into shared snapshot", async () => {
	const source = await readFile(
		new URL("../src/services/system-management.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /configurationOwnershipSnapshot\(\)/);
	assert.match(source, /configurationMigrationReadiness\(runtimeSettings, rawSecureSettings\)/);
	assert.match(source, /configuration,/);
});

test("Web Admin serializer exposes readiness metadata without secret values", () => {
	const data = serializeSystem({
		generatedAt: 1,
		health: { status: "healthy", reasonCodes: [], critical: [], warnings: [], notices: [] },
		runtime: { version: "0.13.0", schemaVersion: 11, timezone: "UTC", integrity: true, botEnabled: true },
		database: {},
		cache: { present: false, fresh: false, expired: false, fetchedAt: 0, expiresAt: 0, ageSeconds: null, ttlRemainingSeconds: null, lastError: null },
		automation: { enabled: false, reason: "automation_disabled", canPublishNow: false, nextPublishAt: 0, lastSuccessAt: 0, lastAttemptAt: 0, lastErrorAt: 0, lastError: null },
		sources: { total: 0, enabled: 0, healthy: 0, failed: 0, unchecked: 0, usdtPriority: [], items: [] },
		admins: { total: 1, activeAdmins: 0, inactiveAdmins: 0, ownerConfigured: true },
		settings: {
			runtime: { version: 2, loaded: true, total: 16, d1Count: 16, invalidD1Keys: [], legacyFallbackKeys: [], defaultFallbackKeys: [], fullyMigrated: true },
			secure: { version: 1, initialized: true, masterKeyConfigured: true, encryptedCount: 4, managedCount: 4, fullyMigrated: true, legacyFallbackCount: 0, missingCount: 0 },
		},
		configuration: {
			ownership: configurationOwnershipSnapshot(),
			migration: {
				runtimeReady: true,
				secureReady: true,
				canRemoveLegacyRuntimeEnv: true,
				canRemoveLegacySecretEnv: true,
				canRemoveAllLegacyEnv: true,
				blockers: [],
			},
		},
	});
	assert.equal(data.configuration.migration.can_remove_all_legacy_env, true);
	assert.deepEqual(data.configuration.ownership.deployment_identity_env_keys, ["APP_NAME", "APP_VERSION"]);
	assert.deepEqual(data.configuration.ownership.infrastructure_secret_env_keys, ["APP_MASTER_KEY"]);
	assert.doesNotMatch(JSON.stringify(data.configuration), /secret-value|token-value/);
});

test("Web Admin System view renders migration readiness through textContent-safe fields", async () => {
	const [html, source] = await Promise.all([
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /id="system-config-all-cleanup"/);
	assert.match(html, /id="system-config-blockers"/);
	assert.match(source, /function renderConfiguration/);
	assert.match(source, /can_remove_all_legacy_env/);
	assert.match(source, /setText\("system-config-blockers"/);
	assert.doesNotMatch(source, /\.innerHTML\s*=/);
});

test("Telegram System shows the shared legacy ENV readiness and blocker codes", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-system.methods.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /snapshot\.configuration\?\.migration/);
	assert.match(source, /Legacy ENV cleanup/);
	assert.match(source, /Configuration migration blockers/);
	assert.match(source, /migration\.canRemoveAllLegacyEnv/);
});

test("wrangler keeps permanent identity and legacy bootstrap variables until readiness is verified", async () => {
	const wranglerText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
	const wrangler = JSON.parse(wranglerText);
	assert.equal(wrangler.assets?.run_worker_first, true);
	assert.equal(wrangler.vars?.APP_NAME, "DRD RATE MANAGER");
	assert.equal(wrangler.vars?.APP_VERSION, "0.13.0");
	assert.ok(Object.hasOwn(wrangler.vars || {}, "TELEGRAM_OWNER_ID"));
	assert.ok(Object.hasOwn(wrangler.vars || {}, "COINGECKO_USER_AGENT"));
	assert.ok(Object.hasOwn(wrangler.vars || {}, "CLOUDFLARE_D1_DATABASE_ID"));
	assert.equal(Object.hasOwn(wrangler.vars || {}, "TELEGRAM_BOT_TOKEN"), false);
	assert.equal(Object.hasOwn(wrangler.vars || {}, "APP_MASTER_KEY"), false);
});

test(".env.example separates permanent configuration from migration-only inputs", async () => {
	const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
	assert.match(env, /PERMANENT DEPLOYMENT IDENTITY/);
	assert.match(env, /PERMANENT INFRASTRUCTURE SECRET/);
	assert.match(env, /LEGACY MIGRATION INPUTS/);
	assert.match(env, /Do not remove these from an existing production environment until/);
});

test("Phase 12.2 does not change schema or application version", async () => {
	const app = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(app, /version:\s*"0\.13\.0"/);
	assert.match(app, /schemaVersion:\s*13/);
});

test("readiness diagnostics never require provider refresh operations", async () => {
	const service = await readFile(
		new URL("../src/services/system-management.service.js", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(service, /forceRefresh/);
	assert.doesNotMatch(service, /fetchTopAssets/);
	assert.doesNotMatch(service, /testSource/);
});
