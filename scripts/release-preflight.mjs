import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const EXPECTED_NAME = "drd-rate-manager";
const EXPECTED_VERSION = "0.2.0";
const EXPECTED_SCHEMA = 13;
const REQUIRED_CHANNELS = ["@DRDNetwork", "@DRDrate"];
const FORBIDDEN_WRANGLER_SECRETS = [
	"APP_MASTER_KEY",
	"TELEGRAM_BOT_TOKEN",
	"TELEGRAM_WEBHOOK_SECRET",
	"COINGECKO_API_KEY",
	"CLOUDFLARE_API_TOKEN",
];

function parseArgs(argv) {
	const options = {
		wranglerPath: "wrangler.jsonc",
		strictConfig: false,
		requireClean: false,
		json: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--strict-config") options.strictConfig = true;
		else if (arg === "--require-clean") options.requireClean = true;
		else if (arg === "--json") options.json = true;
		else if (arg === "--wrangler") {
			const next = argv[index + 1];
			if (!next) throw new Error("--wrangler requires a path.");
			options.wranglerPath = next;
			index += 1;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function stripJsonComments(source) {
	let output = "";
	let inString = false;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;

	for (let index = 0; index < source.length; index += 1) {
		const current = source[index];
		const next = source[index + 1];

		if (lineComment) {
			if (current === "\n") {
				lineComment = false;
				output += current;
			}
			continue;
		}
		if (blockComment) {
			if (current === "*" && next === "/") {
				blockComment = false;
				index += 1;
			} else if (current === "\n") {
				output += "\n";
			}
			continue;
		}
		if (inString) {
			output += current;
			if (escaped) escaped = false;
			else if (current === "\\") escaped = true;
			else if (current === '"') inString = false;
			continue;
		}
		if (current === '"') {
			inString = true;
			output += current;
			continue;
		}
		if (current === "/" && next === "/") {
			lineComment = true;
			index += 1;
			continue;
		}
		if (current === "/" && next === "*") {
			blockComment = true;
			index += 1;
			continue;
		}
		output += current;
	}
	return output;
}

function readText(path) {
	return readFileSync(resolve(path), "utf8");
}

function readJson(path) {
	return JSON.parse(stripJsonComments(readText(path)));
}

function matchNumber(source, expression, label) {
	const match = source.match(expression);
	if (!match) throw new Error(`Unable to read ${label}.`);
	return Number(match[1]);
}

function matchString(source, expression, label) {
	const match = source.match(expression);
	if (!match) throw new Error(`Unable to read ${label}.`);
	return String(match[1]);
}

function git(args) {
	const result = spawnSync("git", args, { encoding: "utf8" });
	if (result.status !== 0) return null;
	return result.stdout.trim();
}

function containsPlaceholder(value) {
	if (typeof value === "string") return /<YOUR_[A-Z0-9_]+>/.test(value);
	if (Array.isArray(value)) return value.some(containsPlaceholder);
	if (value && typeof value === "object")
		return Object.values(value).some(containsPlaceholder);
	return false;
}

function run(options) {
	const checks = [];
	const warnings = [];
	const fail = (code, message) => checks.push({ ok: false, code, message });
	const pass = (code, message) => checks.push({ ok: true, code, message });
	const expect = (condition, code, message) =>
		condition ? pass(code, message) : fail(code, message);

	const packageJson = readJson("package.json");
	const wrangler = readJson(options.wranglerPath);
	const appSource = readText("src/config/app.js");
	const databaseSource = readText("src/database/database.js");
	const membershipSource = readText("src/services/required-membership.service.js");
	const readme = readText("README.md");
	const checklist = readText("docs/release-checklist.md");
	const finalizer = readText("scripts/finalize-config-cleanup.mjs");

	const appVersion = matchString(
		appSource,
		/version:\s*"([^"]+)"/,
		"APP version",
	);
	const schemaVersion = matchNumber(
		appSource,
		/schemaVersion:\s*(\d+)/,
		"schema version",
	);
	const wranglerVersion = String(wrangler?.vars?.APP_VERSION ?? "<missing>");

	expect(
		packageJson.name === EXPECTED_NAME,
		"package_name",
		`package name is ${EXPECTED_NAME}`,
	);
	expect(
		packageJson.version === EXPECTED_VERSION,
		"package_version",
		`package version is ${EXPECTED_VERSION}`,
	);
	expect(
		appVersion === EXPECTED_VERSION,
		"app_version",
		`APP version is ${EXPECTED_VERSION}`,
	);
	expect(
		wranglerVersion === EXPECTED_VERSION,
		"wrangler_version",
		`Wrangler APP_VERSION is ${wranglerVersion}; expected ${EXPECTED_VERSION}`,
	);
	expect(
		schemaVersion === EXPECTED_SCHEMA,
		"schema_version",
		`schema version is ${EXPECTED_SCHEMA}`,
	);

	expect(
		wrangler.main === "src/index.js",
		"worker_entry",
		"Worker entrypoint is src/index.js",
	);
	expect(
		wrangler?.assets?.binding === "ASSETS" &&
			wrangler?.assets?.run_worker_first === true,
		"private_assets",
		"Admin assets use ASSETS with run_worker_first",
	);
	expect(
		Array.isArray(wrangler.d1_databases) &&
			wrangler.d1_databases.some((item) => item.binding === "DB"),
		"d1_binding",
		"D1 DB binding exists",
	);
	expect(
		Array.isArray(wrangler?.triggers?.crons) &&
			wrangler.triggers.crons.includes("* * * * *"),
		"cron",
		"one-minute Cron trigger is configured",
	);

	for (const secret of FORBIDDEN_WRANGLER_SECRETS) {
		expect(
			!Object.hasOwn(wrangler.vars || {}, secret),
			`secret_${secret.toLowerCase()}`,
			`${secret} is not stored in wrangler vars`,
		);
	}

	const channelMatches = [
		...membershipSource.matchAll(
			/username:\s*"(@[A-Za-z0-9_]+)",\s*immutable:\s*true/g,
		),
	].map((match) => match[1]);
	expect(
		JSON.stringify(channelMatches) === JSON.stringify(REQUIRED_CHANNELS),
		"membership_channels",
		"mandatory Telegram channels are exact and immutable",
	);

	for (const table of [
		"secure_settings",
		"web_admin_users",
		"web_admin_login_history",
		"automation_runs",
		"api_tokens",
	]) {
		expect(
			databaseSource.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
			`table_${table}`,
			`${table} bootstrap contract exists`,
		);
	}

	expect(
		packageJson.scripts?.["release:preflight"] ===
			"node scripts/release-preflight.mjs",
		"preflight_script",
		"release:preflight script is registered",
	);
	expect(
		String(packageJson.scripts?.["release:check"] || "").includes("npm test"),
		"release_tests",
		"release:check runs the full test suite",
	);
	expect(
		String(packageJson.scripts?.["release:check"] || "").includes(
			"npm run check",
		),
		"release_check",
		"release:check runs syntax/format checks",
	);
	expect(
		String(packageJson.scripts?.["release:check"] || "").includes(
			"release:preflight",
		),
		"release_preflight",
		"release:check runs release preflight",
	);
	expect(
		!/wrangler\s+(?:deploy|publish)|versions\s+upload/i.test(
			String(packageJson.scripts?.["release:check"] || ""),
		),
		"no_auto_deploy",
		"release:check performs no deployment",
	);

	expect(
		/Schema version:\s*\*\*13\*\*/.test(readme),
		"readme_schema",
		"README documents schema 13",
	);
	expect(
		!/Schema version:\s*\*\*8\*\*/.test(readme) &&
			!/single `worker\.js`/i.test(readme),
		"readme_current",
		"README has no stale schema-8/single-worker guidance",
	);
	expect(
		readme.includes("/docs") && readme.includes("/openapi.json"),
		"readme_api_docs",
		"README documents API docs surfaces",
	);
	expect(
		readme.includes("@DRDNetwork") && readme.includes("@DRDrate"),
		"readme_membership",
		"README documents mandatory membership channels",
	);

	expect(
		/d1 export/i.test(checklist) && /--remote/.test(checklist),
		"backup_checklist",
		"release checklist requires a remote D1 export",
	);
	expect(
		/rollback/i.test(checklist),
		"rollback_checklist",
		"release checklist includes rollback planning",
	);
	expect(
		/post-deploy/i.test(checklist),
		"smoke_checklist",
		"release checklist includes post-deploy verification",
	);
	expect(
		/getChatMember/i.test(checklist) && /Administrator/i.test(checklist),
		"membership_checklist",
		"release checklist covers Telegram membership prerequisites",
	);

	expect(
		/Without --write this command is a dry-run/.test(finalizer),
		"config_dry_run",
		"configuration finalizer remains dry-run by default",
	);
	expect(
		!/wrangler\s+(?:deploy|publish)|versions\s+upload/i.test(finalizer),
		"config_no_deploy",
		"configuration finalizer performs no deployment",
	);

	if (containsPlaceholder(wrangler)) {
		const message = `Wrangler configuration ${options.wranglerPath} still contains <YOUR_...> placeholders.`;
		if (options.strictConfig) fail("config_placeholders", message);
		else warnings.push({ code: "config_placeholders", message });
	} else {
		pass(
			"config_placeholders",
			"Wrangler configuration contains no template placeholders",
		);
	}

	const branch = git(["branch", "--show-current"]);
	const head = git(["rev-parse", "--short", "HEAD"]);
	const dirty = git(["status", "--porcelain"]);
	if (branch) pass("git_branch", `git branch: ${branch}`);
	if (head) pass("git_head", `git HEAD: ${head}`);
	if (dirty) {
		const message = "Working tree has uncommitted changes.";
		if (options.requireClean) fail("git_clean", message);
		else warnings.push({ code: "git_clean", message });
	} else if (dirty !== null) {
		pass("git_clean", "working tree is clean");
	}

	const failures = checks.filter((item) => !item.ok);
	const result = {
		ok: failures.length === 0,
		version: EXPECTED_VERSION,
		schemaVersion: EXPECTED_SCHEMA,
		checks,
		warnings,
		failures,
	};

	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		for (const item of checks)
			console.log(`${item.ok ? "PASS" : "FAIL"} ${item.code}: ${item.message}`);
		for (const warning of warnings)
			console.log(`WARN ${warning.code}: ${warning.message}`);
		console.log("");
		console.log(
			result.ok ? "Release preflight PASSED." : "Release preflight FAILED.",
		);
		console.log(
			`Version ${EXPECTED_VERSION} · schema ${EXPECTED_SCHEMA} · ${checks.length - failures.length}/${checks.length} checks passed`,
		);
	}

	return result.ok ? 0 : 1;
}

try {
	const options = parseArgs(process.argv.slice(2));
	process.exitCode = run(options);
} catch (error) {
	console.error(`Release preflight error: ${error?.message || String(error)}`);
	process.exitCode = 2;
}
