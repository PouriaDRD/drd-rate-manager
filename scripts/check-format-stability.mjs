import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const supported = /\.(?:js|mjs|json|jsonc|css|html|md)$/i;

function gitFiles(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const files = [
  ...new Set([
    ...gitFiles(["diff", "--name-only", "--diff-filter=ACMR"]),
    ...gitFiles(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
    ...gitFiles(["ls-files", "--others", "--exclude-standard"]),
  ]),
].filter((file) => supported.test(file));

if (!files.length) {
  console.log("Format stability OK: no changed text files.");
  process.exit(0);
}

const failures = [];
for (const file of files) {
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\r")) failures.push(`${file}: CRLF/CR line endings`);
  if (/[ \t]+$/m.test(source)) failures.push(`${file}: trailing whitespace`);
  if (source && !source.endsWith("\n")) failures.push(`${file}: missing final newline`);
}

if (failures.length) {
  console.error("Format stability issues:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Format stability OK: ${files.length} changed text file(s).`);
