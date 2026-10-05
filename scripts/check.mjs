import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["src", "public/admin/assets", "tests"];
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function walk(path) {
	const files = [];
	for (const entry of await readdir(path, { withFileTypes: true })) {
		const target = join(path, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(target)));
		else if (entry.isFile() && target.endsWith(".js")) files.push(target);
	}
	return files;
}

const files = [];
for (const root of roots) {
	try {
		files.push(...(await walk(join(projectRoot, root))));
	} catch {
		// Optional roots can be absent in partial workspaces.
	}
}
for (const file of files) {
	const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax OK: ${files.length} JavaScript files`);
