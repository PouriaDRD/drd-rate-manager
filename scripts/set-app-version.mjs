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

const ALLOWED_TARGET_EXTENSIONS = new Set([
	".js",
	".mjs",
	".json",
	".jsonc",
	".md",
	".html",
	".env",
	".example",
]);

function targetExtension(filePath) {
	const base = path.basename(filePath);
	if (base === ".env" || base === ".env.example") return ".example";
	return path.extname(filePath).toLowerCase();
}

for (const target of VERSION_TARGETS) {
	if (!ALLOWED_TARGET_EXTENSIONS.has(targetExtension(target))) {
		throw new Error(`Version target has an unsupported extension: ${target}`);
	}
}

const packagePath = path.join(ROOT, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const currentVersion = String(packageJson.version || "").trim();

if (!currentVersion) throw new Error("Current package version is missing.");
if (currentVersion === newVersion) {
	throw new Error(`Version is already ${newVersion}.`);
}

const escapedCurrent = currentVersion.replaceAll(".", "\\.");
const escapedNew = newVersion.replaceAll(".", "\\.");

function replaceVersionReferences(source) {
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

const plan = [];

for (const relativePath of VERSION_TARGETS) {
	const absolutePath = path.join(ROOT, relativePath);
	const before = await readFile(absolutePath, "utf8");
	const result = replaceVersionReferences(before);

	if (result.replacements === 0) {
		throw new Error(
			`Expected current version ${currentVersion} in allowlisted target: ${relativePath}`,
		);
	}

	if (
		result.source.includes(currentVersion) ||
		result.source.includes(escapedCurrent)
	) {
		throw new Error(`Version replacement is incomplete in: ${relativePath}`);
	}

	plan.push({
		relativePath,
		absolutePath,
		before,
		after: result.source,
		replacements: result.replacements,
	});
}

console.log(`Version plan: ${currentVersion} -> ${newVersion}`);
console.log(
	shouldWrite
		? "Mode: write"
		: "Mode: dry-run (no files written; re-run with --write to apply)",
);
console.log(`Allowlisted targets: ${plan.length}`);

for (const item of plan) {
	console.log(` - ${item.relativePath} (${item.replacements} replacement(s))`);
}

if (!shouldWrite) {
	process.exit(0);
}

for (const item of plan) {
	await writeFile(item.absolutePath, item.after, "utf8");
}

console.log(`Updated ${plan.length} allowlisted file(s).`);
