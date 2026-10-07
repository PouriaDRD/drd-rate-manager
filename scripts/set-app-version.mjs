import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const newVersion = String(args.find((arg) => !arg.startsWith("--")) || "").trim();
const shouldWrite = args.includes("--write");
const unknownOptions = args.filter((arg) => arg.startsWith("--") && arg !== "--write");

if (unknownOptions.length) {
	console.error(`Unknown option(s): ${unknownOptions.join(", ")}`);
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(newVersion)) {
	console.error("Usage: node scripts/set-app-version.mjs <new-version> [--write]");
	process.exit(1);
}

const VERSION_TARGETS = Object.freeze([
	"package.json",
	"package-lock.json",
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
]);

const VERSION_ASSERTION_TARGETS = Object.freeze([
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
]);

const packagePath = path.join(ROOT, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const currentVersion = String(packageJson.version || "").trim();

if (!currentVersion) throw new Error("Current package version is missing.");
if (currentVersion === newVersion) {
	throw new Error(`Version is already ${newVersion}.`);
}

const escapedCurrent = currentVersion.replaceAll(".", "\\.");
const escapedNew = newVersion.replaceAll(".", "\\.");

function replaceAllVersionReferences(source) {
	let replacements = 0;

	const literalParts = source.split(currentVersion);
	if (literalParts.length > 1) {
		replacements += literalParts.length - 1;
		source = literalParts.join(newVersion);
	}

	const escapedParts = source.split(escapedCurrent);
	if (escapedParts.length > 1) {
		replacements += escapedParts.length - 1;
		source = escapedParts.join(escapedNew);
	}

	return { source, replacements };
}

function replaceCurrentVersionAssertions(source) {
	let assertionReplacements = 0;
	let titleReplacements = 0;

	const lines = source.split("\n").map((line) => {
		let next = line;

		if (/\btest\(["']/.test(next) && next.includes(currentVersion)) {
			const parts = next.split(currentVersion);
			titleReplacements += parts.length - 1;
			next = parts.join(newVersion);
		}

		if (
			next.includes("assert.match(") &&
			next.includes("version:") &&
			next.includes(escapedCurrent)
		) {
			const parts = next.split(escapedCurrent);
			assertionReplacements += parts.length - 1;
			next = parts.join(escapedNew);
		}

		if (
			next.includes("assert.equal(") &&
			next.includes("APP_VERSION") &&
			next.includes(`"${currentVersion}"`)
		) {
			const parts = next.split(`"${currentVersion}"`);
			assertionReplacements += parts.length - 1;
			next = parts.join(`"${newVersion}"`);
		}

		return next;
	});

	return {
		source: lines.join("\n"),
		replacements: assertionReplacements + titleReplacements,
		assertionReplacements,
		titleReplacements,
	};
}

const plan = [];

for (const relativePath of VERSION_TARGETS) {
	const absolutePath = path.join(ROOT, relativePath);
	const before = await readFile(absolutePath, "utf8");
	const result = replaceAllVersionReferences(before);

	if (result.replacements === 0) {
		throw new Error(
			`Expected current version ${currentVersion} in identity target: ${relativePath}`,
		);
	}

	if (
		result.source.includes(currentVersion) ||
		result.source.includes(escapedCurrent)
	) {
		throw new Error(`Version replacement is incomplete in identity target: ${relativePath}`);
	}

	plan.push({
		kind: "identity",
		relativePath,
		absolutePath,
		after: result.source,
		replacements: result.replacements,
	});
}

for (const relativePath of VERSION_ASSERTION_TARGETS) {
	const absolutePath = path.join(ROOT, relativePath);
	const before = await readFile(absolutePath, "utf8");
	const result = replaceCurrentVersionAssertions(before);

	if (result.assertionReplacements === 0) {
		throw new Error(
			`Expected a current-version assertion for ${currentVersion} in: ${relativePath}`,
		);
	}

	plan.push({
		kind: "test-assertion",
		relativePath,
		absolutePath,
		after: result.source,
		replacements: result.replacements,
		assertionReplacements: result.assertionReplacements,
		titleReplacements: result.titleReplacements,
	});
}

console.log(`Version plan: ${currentVersion} -> ${newVersion}`);
console.log(
	shouldWrite
		? "Mode: write"
		: "Mode: dry-run (no files written; re-run with --write to apply)",
);
console.log(`Identity targets: ${VERSION_TARGETS.length}`);
console.log(`Current-version test targets: ${VERSION_ASSERTION_TARGETS.length}`);

for (const item of plan) {
	const details =
		item.kind === "test-assertion"
			? `${item.assertionReplacements} assertion(s), ${item.titleReplacements} title reference(s)`
			: `${item.replacements} replacement(s)`;
	console.log(` - [${item.kind}] ${item.relativePath} (${details})`);
}

if (!shouldWrite) {
	process.exit(0);
}

for (const item of plan) {
	await writeFile(item.absolutePath, item.after, "utf8");
}

console.log(`Updated ${plan.length} allowlisted file(s).`);
