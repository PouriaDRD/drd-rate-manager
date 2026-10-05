import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function walk(path) {
	const files = [];
	for (const entry of await readdir(path, { withFileTypes: true })) {
		const target = join(path, entry.name);
		if (entry.isDirectory()) files.push(...await walk(target));
		else if (entry.isFile() && target.endsWith(".js")) files.push(target);
	}
	return files;
}

const files = await walk(new URL("../src", import.meta.url).pathname);
for (const file of files) {
	const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax OK: ${files.length} JavaScript files`);
