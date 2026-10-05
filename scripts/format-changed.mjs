import { spawnSync } from "node:child_process";

const supported = /\.(?:js|json|jsonc|css|html|md)$/i;
function gitFiles(args) {
	const result = spawnSync("git", args, { encoding: "utf8" });
	if (result.status !== 0) return [];
	return result.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

const files = [...new Set([
	...gitFiles(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
	...gitFiles(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
])].filter((file) => supported.test(file));

if (!files.length) {
	console.log("No changed format-supported files.");
	process.exit(0);
}

const command = process.platform === "win32" ? "prettier.cmd" : "prettier";
const result = spawnSync(command, ["--write", ...files], { stdio: "inherit" });
process.exit(result.status || 0);
