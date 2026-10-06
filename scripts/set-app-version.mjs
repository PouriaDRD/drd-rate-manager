import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const newVersion = String(process.argv[2] || "").trim();

if (!/^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$/.test(newVersion)) {
	console.error("Usage: node scripts/set-app-version.mjs <new-version>");
	process.exit(1);
}

const packagePath = path.join(ROOT, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const currentVersion = String(packageJson.version || "").trim();

if (!currentVersion) throw new Error("Current package version is missing.");

const SKIP_DIRS = new Set([
	".git", "node_modules", ".wrangler", "coverage", "dist", "build",
]);

const TEXT_EXTENSIONS = new Set([
	".js", ".mjs", ".cjs", ".json", ".jsonc", ".md", ".txt",
	".yml", ".yaml", ".env", ".example", ".toml", ".html", ".css",
	".svg", ".xml",
]);

function isTextFile(filePath) {
	const base = path.basename(filePath);
	if (base === ".env" || base === ".env.example") return true;
	return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function collect(dir, result = []) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await collect(fullPath, result);
			continue;
		}
		if (entry.isFile() && isTextFile(fullPath)) result.push(fullPath);
	}
	return result;
}

const escapedCurrent = currentVersion.replaceAll(".", "\\.");
const escapedNew = newVersion.replaceAll(".", "\\.");
const files = await collect(ROOT);
const changed = [];

for (const filePath of files) {
	let source = await readFile(filePath, "utf8");
	const before = source;
	source = source.split(currentVersion).join(newVersion);
	source = source.split(escapedCurrent).join(escapedNew);

	if (source !== before) {
		await writeFile(filePath, source, "utf8");
		changed.push(path.relative(ROOT, filePath));
	}
}

const leftovers = [];
for (const filePath of files) {
	const source = await readFile(filePath, "utf8");
	if (source.includes(currentVersion) || source.includes(escapedCurrent)) {
		leftovers.push(path.relative(ROOT, filePath));
	}
}

if (leftovers.length) {
	console.error("Version replacement is incomplete:");
	for (const file of leftovers) console.error(` - ${file}`);
	process.exit(1);
}

console.log(`Version: ${currentVersion} -> ${newVersion}`);
console.log(`Updated ${changed.length} file(s).`);
for (const file of changed) console.log(` - ${file}`);
