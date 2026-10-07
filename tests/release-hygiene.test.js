import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SETTER_PATH = fileURLToPath(
	new URL("../scripts/set-app-version.mjs", import.meta.url),
);

const IDENTITY_TARGETS = [
	".env.example",
	"wrangler.jsonc",
	"src/config/app.js",
	"public/admin/index.html",
	"scripts/release-preflight.mjs",
	"README.md",
	"README.fa.md",
	"README.en.md",
	"docs/README.md",
	"tests/foundation.test.js",
	"tests/phase18.test.js",
	"tests/phase19.test.js",
];

const ASSERTION_TARGETS = [
	"tests/phase12.2.test.js",
	"tests/phase13.1.test.js",
	"tests/phase13.2.test.js",
	"tests/phase13.3.test.js",
	"tests/phase14.1.test.js",
	"tests/phase14.2.test.js",
	"tests/phase14.3.test.js",
	"tests/phase15.1.test.js",
	"tests/phase15.2.test.js",
	"tests/phase15.3.test.js",
	"tests/phase15.4.test.js",
	"tests/phase15.5.test.js",
	"tests/phase16.1.test.js",
	"tests/phase16.2.test.js",
	"tests/phase16.3.test.js",
	"tests/phase16.4.test.js",
	"tests/phase17.test.js",
	"tests/phase19.8.test.js",
	"tests/phase19.8b.test.js",
	"tests/phase19.8c.test.js",
	"tests/phase19.8d.test.js",
];

async function text(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function writeFixture(root, relativePath, content) {
	const target = path.join(root, relativePath);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, content, "utf8");
}

async function makeVersionFixture() {
	const root = await mkdtemp(path.join(tmpdir(), "drd-version-"));

	await writeFixture(
		root,
		"package.json",
		'{\n  "name": "drd-rate-manager",\n  "version": "0.2.0"\n}\n',
	);
	await writeFixture(
		root,
		"package-lock.json",
		'{\n  "name": "drd-rate-manager",\n  "version": "0.2.0",\n  "packages": {"": {"version": "0.2.0"}}\n}\n',
	);

	for (const relativePath of IDENTITY_TARGETS) {
		const content =
			relativePath === "tests/phase19.test.js"
				? 'assert.match(source, /0\\.2\\.0/);\n'
				: "current=0.2.0\n";
		await writeFixture(root, relativePath, content);
	}

	for (const relativePath of ASSERTION_TARGETS) {
		const extra =
			relativePath === "tests/phase12.2.test.js"
				? 'assert.equal(wrangler.vars?.APP_VERSION, "0.2.0");\n'
				: "";
		await writeFixture(
			root,
			relativePath,
			[
				'test("historical phase kept 0.2.0", () => {});',
				'const fixture = { version: "0.2.0" };',
				'assert.match(app, /version:\\s*"0\\.2\\.0"/);',
				extra.trim(),
				"",
			]
				.filter(Boolean)
				.join("\n"),
		);
	}

	await writeFixture(
		root,
		"docs/historical-release-note.md",
		"Production baseline was 0.2.0 and must remain historical.\n",
	);

	return root;
}

test("version setter uses explicit identity and current-version assertion targets", async () => {
	const source = await readFile(SETTER_PATH, "utf8");

	assert.match(source, /VERSION_TARGETS/);
	assert.match(source, /VERSION_ASSERTION_TARGETS/);
	assert.match(source, /replaceCurrentVersionAssertions/);
	assert.match(source, /Mode: dry-run/);
	assert.match(source, /--write/);
	assert.doesNotMatch(source, /\breaddir\b/);
	assert.doesNotMatch(source, /collect\(/);
});

test("version setter updates current identity/assertions while preserving historical fixtures", async () => {
	const root = await makeVersionFixture();

	try {
		const historicalPath = path.join(root, "docs/historical-release-note.md");
		const fixtureTarget = path.join(root, "tests/phase15.5.test.js");

		const dryRun = spawnSync(process.execPath, [SETTER_PATH, "0.2.1"], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
		assert.match(dryRun.stdout, /Mode: dry-run/);

		const writeRun = spawnSync(
			process.execPath,
			[SETTER_PATH, "0.2.1", "--write"],
			{ cwd: root, encoding: "utf8" },
		);
		assert.equal(writeRun.status, 0, writeRun.stderr || writeRun.stdout);
		assert.match(writeRun.stdout, /Identity targets: 14/);
		assert.match(writeRun.stdout, /Current-version test targets: 21/);
		assert.match(writeRun.stdout, /Updated 35 allowlisted file\(s\)/);

		assert.equal(
			await readFile(historicalPath, "utf8"),
			"Production baseline was 0.2.0 and must remain historical.\n",
		);

		const fixtureSource = await readFile(fixtureTarget, "utf8");
		assert.match(fixtureSource, /fixture = \{ version: "0\.2\.0" \}/);
		assert.match(fixtureSource, /historical phase kept 0\.2\.1/);
		assert.match(fixtureSource, /version:\\s\*"0\\\.2\\\.1"/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("version setter fails before writing if a current-version assertion target is inconsistent", async () => {
	const root = await makeVersionFixture();

	try {
		await writeFile(
			path.join(root, "tests/phase13.1.test.js"),
			'const fixture = { version: "0.2.0" };\n',
			"utf8",
		);

		const result = spawnSync(
			process.execPath,
			[SETTER_PATH, "0.2.1", "--write"],
			{ cwd: root, encoding: "utf8" },
		);

		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/Expected a current-version assertion for 0\.2\.0 in: tests\/phase13\.1\.test\.js/,
		);
		assert.match(
			await readFile(path.join(root, "package.json"), "utf8"),
			/0\.2\.0/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("release changelog and versioned notes match the current application identity", async () => {
	const pkg = JSON.parse(await text("package.json"));
	const version = String(pkg.version);
	const escapedVersion = version.replaceAll(".", "\\.");

	const [changelog, releaseNotes] = await Promise.all([
		text("CHANGELOG.md"),
		text(`docs/releases/v${version}.md`),
	]);

	assert.match(changelog, new RegExp(`\\[${escapedVersion}\\]`));
	assert.match(
		releaseNotes,
		new RegExp(`DRD Rate Manager v${escapedVersion}`),
	);

	for (const source of [changelog, releaseNotes]) {
		assert.match(source, /D1 schema:\s*`13`|schema remains `13`/i);
		assert.match(source, /Runtime Settings Catalog.*`3`/i);
		assert.match(source, /Secure Settings Catalog.*`1`/i);
		assert.match(source, /APP_MASTER_KEY/);
		assert.doesNotMatch(source, /APP_MASTER_KEY\s*=\s*\S+/);
		assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN\s*=\s*\S+/);
		assert.doesNotMatch(source, /COINGECKO_API_KEY\s*=\s*\S+/);
		assert.doesNotMatch(source, /CLOUDFLARE_API_TOKEN\s*=\s*\S+/);
	}
});
