import assert from "node:assert/strict";
import {
	mkdtemp,
	readFile,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	buildWranglerLegacyCleanup,
	extractConfigurationProof,
	validateConfigurationCleanupProof,
} from "../src/config/config-cleanup.js";
import { configurationOwnershipSnapshot } from "../src/config/config-ownership.js";
import { LEGACY_RUNTIME_ENV_KEYS } from "../src/config/runtime-settings.js";
import { LEGACY_SECURE_ENV_KEYS } from "../src/config/secure-settings.js";

const finalizerPath = fileURLToPath(
	new URL("../scripts/finalize-config-cleanup.mjs", import.meta.url),
);

function readyProof() {
	const ownership = configurationOwnershipSnapshot();
	return {
		success: true,
		data: {
			generated_at: new Date().toISOString(),
			configuration: {
				ownership: {
					version: ownership.version,
					runtime_settings_version: ownership.runtimeSettingsVersion,
					secure_settings_version: ownership.secureSettingsVersion,
					valid: true,
				},
				migration: {
					runtime_ready: true,
					secure_ready: true,
					can_remove_legacy_runtime_env: true,
					can_remove_legacy_secret_env: true,
					can_remove_all_legacy_env: true,
					blockers: [],
				},
			},
		},
	};
}

function wranglerFixture() {
	return {
		name: "drd-rate-manager-bot",
		vars: {
			APP_NAME: "DRD RATE MANAGER",
			APP_VERSION: "0.2.0",
			TIMEZONE: "Asia/Tehran",
			TELEGRAM_OWNER_ID: "123456",
			COINGECKO_USER_AGENT: "Agent",
			WALLEX_API_URL: "https://example.test",
		},
	};
}

test("finalizer accepts the authenticated System API envelope shape", () => {
	const proof = extractConfigurationProof(readyProof());
	assert.equal(proof.ownership.valid, true);
	assert.equal(proof.migration.canRemoveAllLegacyEnv, true);
});

test("ready proof must match local ownership/runtime/secure catalog versions", () => {
	const validation = validateConfigurationCleanupProof(readyProof());
	assert.equal(validation.ok, true);

	const stale = readyProof();
	stale.data.configuration.ownership.runtime_settings_version -= 1;
	const rejected = validateConfigurationCleanupProof(stale);
	assert.equal(rejected.ok, false);
	assert.ok(rejected.reasons.includes("runtime_settings_version_mismatch"));
});

test("stale or missing readiness snapshots fail closed", () => {
	const missing = readyProof();
	delete missing.data.generated_at;
	assert.ok(
		validateConfigurationCleanupProof(missing).reasons.includes("snapshot_timestamp_missing"),
	);

	const stale = readyProof();
	stale.data.generated_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
	assert.ok(
		validateConfigurationCleanupProof(stale).reasons.includes("snapshot_stale"),
	);
});

test("any live migration blocker fails closed", () => {
	const blocked = readyProof();
	blocked.data.configuration.migration.can_remove_all_legacy_env = false;
	blocked.data.configuration.migration.blockers = [
		{ code: "runtime_settings_not_fully_d1", keys: ["general.timezone"] },
	];
	const validation = validateConfigurationCleanupProof(blocked);
	assert.equal(validation.ok, false);
	assert.ok(validation.reasons.includes("legacy_env_cleanup_blocked"));
	assert.ok(validation.reasons.includes("migration_blockers_present"));
});

test("wrangler cleanup removes only legacy runtime/secure ENV keys", () => {
	const result = buildWranglerLegacyCleanup(wranglerFixture(), readyProof());
	assert.equal(result.config.vars.APP_NAME, "DRD RATE MANAGER");
	assert.equal(result.config.vars.APP_VERSION, "0.2.0");
	assert.equal(Object.hasOwn(result.config.vars, "TIMEZONE"), false);
	assert.equal(Object.hasOwn(result.config.vars, "TELEGRAM_OWNER_ID"), false);
	assert.equal(Object.hasOwn(result.config.vars, "COINGECKO_USER_AGENT"), false);
	assert.equal(Object.hasOwn(result.config.vars, "WALLEX_API_URL"), false);
	assert.ok(result.removedRuntimeVars.length >= 4);
});

test("cleanup never mutates the input wrangler object", () => {
	const input = wranglerFixture();
	const before = JSON.stringify(input);
	buildWranglerLegacyCleanup(input, readyProof());
	assert.equal(JSON.stringify(input), before);
});

test("legacy secure Worker secrets are reported for manual deletion, not silently discarded", () => {
	const result = buildWranglerLegacyCleanup(wranglerFixture(), readyProof());
	assert.deepEqual(
		[...result.manualLegacySecretCleanup].sort(),
		[...LEGACY_SECURE_ENV_KEYS].sort(),
	);
	assert.deepEqual(result.permanentInfrastructureSecrets, ["APP_MASTER_KEY"]);
});

test("cleanup catalog covers every legacy runtime key", () => {
	const result = buildWranglerLegacyCleanup(wranglerFixture(), readyProof());
	for (const key of result.removedRuntimeVars) {
		assert.ok(LEGACY_RUNTIME_ENV_KEYS.includes(key), key);
	}
});

test("Web Admin System serialization exposes proof catalog versions", async () => {
	const source = await readFile(
		new URL("../src/controllers/web-admin-system.controller.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /runtime_settings_version: ownership\.runtimeSettingsVersion/);
	assert.match(source, /secure_settings_version: ownership\.secureSettingsVersion/);
});

test("package exposes an explicit config:finalize operation", async () => {
	const pkg = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	);
	assert.equal(pkg.scripts["config:finalize"], "node scripts/finalize-config-cleanup.mjs");
});

test("finalizer dry-run leaves wrangler unchanged", async () => {
	const dir = await mkdtemp(join(tmpdir(), "drd-config-finalize-"));
	const snapshotPath = join(dir, "system.json");
	const wranglerPath = join(dir, "wrangler.jsonc");
	await writeFile(snapshotPath, JSON.stringify(readyProof()), "utf8");
	await writeFile(wranglerPath, JSON.stringify(wranglerFixture(), null, 2), "utf8");
	const before = await readFile(wranglerPath, "utf8");

	const run = spawnSync(
		process.execPath,
		[
			finalizerPath,
			snapshotPath,
			"--wrangler",
			wranglerPath,
		],
		{ encoding: "utf8" },
	);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /Dry-run only/);
	assert.equal(await readFile(wranglerPath, "utf8"), before);
});

test("finalizer --write removes runtime fallbacks but performs no deployment", async () => {
	const dir = await mkdtemp(join(tmpdir(), "drd-config-finalize-"));
	const snapshotPath = join(dir, "system.json");
	const wranglerPath = join(dir, "wrangler.jsonc");
	await writeFile(snapshotPath, JSON.stringify(readyProof()), "utf8");
	await writeFile(wranglerPath, JSON.stringify(wranglerFixture(), null, 2), "utf8");

	const run = spawnSync(
		process.execPath,
		[
			finalizerPath,
			snapshotPath,
			"--write",
			"--wrangler",
			wranglerPath,
		],
		{ encoding: "utf8" },
	);
	assert.equal(run.status, 0, run.stderr);
	const after = JSON.parse(await readFile(wranglerPath, "utf8"));
	assert.equal(after.vars.APP_NAME, "DRD RATE MANAGER");
	assert.equal(Object.hasOwn(after.vars, "TIMEZONE"), false);
	assert.match(run.stdout, /No Cloudflare secrets were deleted and no deployment was performed/);
});

test("blocked proof never changes wrangler even with --write", async () => {
	const dir = await mkdtemp(join(tmpdir(), "drd-config-finalize-"));
	const snapshotPath = join(dir, "system.json");
	const wranglerPath = join(dir, "wrangler.jsonc");
	const blocked = readyProof();
	blocked.data.configuration.migration.can_remove_all_legacy_env = false;
	blocked.data.configuration.migration.blockers = [
		{ code: "secure_settings_missing", keys: ["telegram.bot_token"] },
	];
	await writeFile(snapshotPath, JSON.stringify(blocked), "utf8");
	await writeFile(wranglerPath, JSON.stringify(wranglerFixture(), null, 2), "utf8");
	const before = await readFile(wranglerPath, "utf8");

	const run = spawnSync(
		process.execPath,
		[
			finalizerPath,
			snapshotPath,
			"--write",
			"--wrangler",
			wranglerPath,
		],
		{ encoding: "utf8" },
	);
	assert.equal(run.status, 3);
	assert.match(run.stderr, /Configuration cleanup BLOCKED/);
	assert.equal(await readFile(wranglerPath, "utf8"), before);
});
