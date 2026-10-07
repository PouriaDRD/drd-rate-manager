import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function text(pathname) {
	return readFile(new URL(`../${pathname}`, import.meta.url), "utf8");
}

async function json(pathname) {
	return JSON.parse(await text(pathname));
}

test("release scripts compose tests checks and preflight without deployment", async () => {
	const pkg = await json("package.json");
	assert.equal(
		pkg.scripts["release:preflight"],
		"node scripts/release-preflight.mjs",
	);
	assert.match(pkg.scripts["release:check"], /npm test/);
	assert.match(pkg.scripts["release:check"], /npm run check/);
	assert.match(pkg.scripts["release:check"], /release:preflight/);
	assert.doesNotMatch(
		pkg.scripts["release:check"],
		/wrangler\s+(deploy|publish)|versions\s+upload/i,
	);
});

test("release preflight passes the current repository candidate", () => {
	const result = spawnSync(
		process.execPath,
		["scripts/release-preflight.mjs", "--json"],
		{
			cwd: new URL("..", import.meta.url),
			encoding: "utf8",
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const report = JSON.parse(result.stdout);
	assert.equal(report.ok, true);
	assert.equal(report.version, "0.2.0");
	assert.equal(report.schemaVersion, 13);
});

test("preflight reports the actual Wrangler APP_VERSION on mismatch", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "drd-preflight-"));
	const wranglerPath = path.join(directory, "wrangler-mismatch.jsonc");

	try {
		const source = await text("wrangler.jsonc");
		await writeFile(
			wranglerPath,
			source.replace(
				/"APP_VERSION":\s*"0\.2\.0"/,
				'"APP_VERSION": "9.9.9"',
			),
			"utf8",
		);

		const result = spawnSync(
			process.execPath,
			[
				"scripts/release-preflight.mjs",
				"--wrangler",
				wranglerPath,
				"--json",
			],
			{
				cwd: new URL("..", import.meta.url),
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 1, result.stderr || result.stdout);
		const report = JSON.parse(result.stdout);
		const failure = report.failures.find(
			(item) => item.code === "wrangler_version",
		);
		assert.ok(failure);
		assert.match(failure.message, /9\.9\.9/);
		assert.match(failure.message, /expected 0\.2\.0/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("strict release preflight rejects template Wrangler placeholders", () => {
	const result = spawnSync(
		process.execPath,
		["scripts/release-preflight.mjs", "--strict-config", "--json"],
		{ cwd: new URL("..", import.meta.url), encoding: "utf8" },
	);
	assert.equal(result.status, 1);
	const report = JSON.parse(result.stdout);
	assert.equal(report.ok, false);
	assert.ok(
		report.failures.some((item) => item.code === "config_placeholders"),
	);
});

test("preflight source contains no deployment operation", async () => {
	const source = await text("scripts/release-preflight.mjs");
	assert.doesNotMatch(
		source,
		/wrangler\s+(deploy|publish)|versions\s+upload/i,
	);
	assert.match(source, /FORBIDDEN_WRANGLER_SECRETS/);
	assert.match(source, /REQUIRED_CHANNELS/);
});

test("README documents current schema architecture API docs and membership", async () => {
	const source = await text("README.md");
	assert.match(source, /Schema version:\s*\*\*13\*\*/);
	assert.doesNotMatch(source, /Schema version:\s*\*\*8\*\*/);
	assert.doesNotMatch(source, /single `worker\.js`/i);
	assert.match(source, /GET \/docs/);
	assert.match(source, /GET \/openapi\.json/);
	assert.match(source, /@DRDNetwork/);
	assert.match(source, /@DRDrate/);
});

test("release checklist requires D1 backup and manual deployment approval", async () => {
	const source = await text("docs/release-checklist.md");
	assert.match(source, /wrangler d1 export drd-rate-manager-db --remote/);
	assert.match(source, /Deployment — manual approval only/);
	assert.match(source, /npx wrangler deploy/);
	assert.match(source, /Rollback plan/);
	assert.match(source, /Post-deploy verification/);
});

test("release checklist preserves membership verification prerequisites", async () => {
	const source = await text("docs/release-checklist.md");
	assert.match(source, /@DRDNetwork/);
	assert.match(source, /@DRDrate/);
	assert.match(source, /getChatMember/);
	assert.match(source, /Administrator/);
	assert.match(
		source,
		/Owner intentionally bypasses membership enforcement/,
	);
});

test("release docs do not embed production secret values", async () => {
	const source = `${await text("README.md")}\n${await text("docs/release-checklist.md")}`;
	assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN\s*=\s*\S+/);
	assert.doesNotMatch(source, /TELEGRAM_WEBHOOK_SECRET\s*=\s*\S+/);
	assert.doesNotMatch(source, /COINGECKO_API_KEY\s*=\s*\S+/);
	assert.doesNotMatch(source, /APP_MASTER_KEY\s*=\s*\S+/);
});

test("configuration finalizer remains review-first and deploy-free", async () => {
	const source = await text("scripts/finalize-config-cleanup.mjs");
	assert.match(source, /Without --write this command is a dry-run/);
	assert.match(
		source,
		/No Cloudflare secrets were deleted and no deployment was performed/,
	);
	assert.doesNotMatch(
		source,
		/wrangler\s+(deploy|publish)|versions\s+upload/i,
	);
});

test("release preflight validates critical D1 and Worker bindings", async () => {
	const source = await text("scripts/release-preflight.mjs");
	for (const marker of [
		"ASSETS",
		"run_worker_first",
		"d1_databases",
		'"DB"',
		'"* * * * *"',
	]) {
		assert.ok(source.includes(marker), `missing ${marker}`);
	}
	for (const table of [
		"secure_settings",
		"web_admin_login_history",
		"automation_runs",
		"api_tokens",
	]) {
		assert.ok(source.includes(table), `missing ${table}`);
	}
});

test("release candidate keeps v0.2.0 and schema 13", async () => {
	const [app, pkg, wrangler] = await Promise.all([
		text("src/config/app.js"),
		json("package.json"),
		json("wrangler.jsonc"),
	]);
	assert.match(app, /version:\s*"0\.2\.0"/);
	assert.match(app, /schemaVersion:\s*13/);
	assert.equal(pkg.version, "0.2.0");
	assert.equal(wrangler.vars.APP_VERSION, "0.2.0");
});

test("Phase 18.1 changes release tooling and docs only, not runtime schema", async () => {
	const [app, database, membership] = await Promise.all([
		text("src/config/app.js"),
		text("src/database/database.js"),
		text("src/services/required-membership.service.js"),
	]);
	assert.match(app, /schemaVersion:\s*13/);
	assert.match(
		database,
		/CREATE TABLE IF NOT EXISTS web_admin_login_history/,
	);
	assert.match(membership, /@DRDNetwork/);
	assert.match(membership, /@DRDrate/);
});
