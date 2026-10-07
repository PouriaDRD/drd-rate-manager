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

const TEXT_TARGETS = [
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

	for (const relativePath of TEXT_TARGETS) {
		const content =
			relativePath === "tests/phase19.test.js"
				? 'assert.match(source, /0\\.2\\.0/);\n'
				: `current=0.2.0\n`;
		await writeFixture(root, relativePath, content);
	}

	await writeFixture(
		root,
		"docs/historical-release-note.md",
		"Production baseline was 0.2.0 and must remain historical.\n",
	);

	return root;
}

test("version setter is explicit allowlist tooling rather than a repository-wide scanner", async () => {
	const source = await readFile(SETTER_PATH, "utf8");

	assert.match(source, /VERSION_TARGETS/);
	assert.match(source, /Mode: dry-run/);
	assert.match(source, /--write/);
	assert.doesNotMatch(source, /\breaddir\b/);
	assert.doesNotMatch(source, /collect\(/);
	assert.ok(source.includes('"public/admin/index.html"'));
	assert.ok(source.includes('"tests/phase19.test.js"'));
	assert.equal(source.includes('"docs/historical-release-note.md"'), false);
});

test("version setter dry-run writes nothing and --write touches only allowlisted identity surfaces", async () => {
	const root = await makeVersionFixture();

	try {
		const historicalPath = path.join(
			root,
			"docs/historical-release-note.md",
		);
		const packagePath = path.join(root, "package.json");

		const dryRun = spawnSync(process.execPath, [SETTER_PATH, "0.2.1"], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
		assert.match(dryRun.stdout, /Mode: dry-run/);
		assert.match(await readFile(packagePath, "utf8"), /0\.2\.0/);
		assert.match(await readFile(historicalPath, "utf8"), /0\.2\.0/);

		const writeRun = spawnSync(
			process.execPath,
			[SETTER_PATH, "0.2.1", "--write"],
			{
				cwd: root,
				encoding: "utf8",
			},
		);
		assert.equal(writeRun.status, 0, writeRun.stderr || writeRun.stdout);
		assert.match(writeRun.stdout, /Mode: write/);
		assert.match(writeRun.stdout, /Updated 14 allowlisted file\(s\)/);

		for (const relativePath of [
			"package.json",
			"package-lock.json",
			...TEXT_TARGETS,
		]) {
			const source = await readFile(path.join(root, relativePath), "utf8");
			assert.doesNotMatch(
				source,
				/0\.2\.0|0\\\.2\\\.0/,
				`stale version in ${relativePath}`,
			);
			assert.match(
				source,
				/0\.2\.1|0\\\.2\\\.1/,
				`new version missing in ${relativePath}`,
			);
		}

		assert.equal(
			await readFile(historicalPath, "utf8"),
			"Production baseline was 0.2.0 and must remain historical.\n",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("version setter fails before writes when an allowlisted target has no current version", async () => {
	const root = await makeVersionFixture();

	try {
		const target = path.join(root, "README.md");
		await writeFile(target, "no version marker here\n", "utf8");

		const result = spawnSync(
			process.execPath,
			[SETTER_PATH, "0.2.1", "--write"],
			{
				cwd: root,
				encoding: "utf8",
			},
		);

		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/Expected current version 0\.2\.0 in allowlisted target: README\.md/,
		);
		assert.match(
			await readFile(path.join(root, "package.json"), "utf8"),
			/0\.2\.0/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
