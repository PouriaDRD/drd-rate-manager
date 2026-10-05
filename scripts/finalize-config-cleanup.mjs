import {
	readFileSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
	buildWranglerLegacyCleanup,
	validateConfigurationCleanupProof,
} from "../src/config/config-cleanup.js";

function usage() {
	console.log(
		[
			"Usage:",
			"  npm run config:finalize -- <system-snapshot.json> [--write] [--wrangler <path>]",
			"",
			"Without --write this command is a dry-run and never modifies wrangler.jsonc.",
			"The snapshot must come from the deployed authenticated System API and report",
			"configuration.migration.can_remove_all_legacy_env=true with zero blockers.",
		].join("\n"),
	);
}

function parseArgs(argv) {
	let snapshotPath = null;
	let wranglerPath = "wrangler.jsonc";
	let write = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--write") {
			write = true;
			continue;
		}
		if (arg === "--wrangler") {
			const next = argv[index + 1];
			if (!next) throw new Error("--wrangler requires a path.");
			wranglerPath = next;
			index += 1;
			continue;
		}
		if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
		if (snapshotPath) throw new Error("Only one system snapshot path may be supplied.");
		snapshotPath = arg;
	}

	return { snapshotPath, wranglerPath, write };
}

function readJson(path, label) {
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		throw new Error(`${label} cannot be read: ${error.message}`);
	}
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${error.message}`);
	}
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function printList(label, values) {
	console.log(`${label}: ${values.length ? values.join(", ") : "none"}`);
}

try {
	const args = parseArgs(process.argv.slice(2));
	if (!args.snapshotPath) {
		usage();
		process.exitCode = 2;
	} else {
		const snapshotPath = resolve(args.snapshotPath);
		const wranglerPath = resolve(args.wranglerPath);
		const snapshot = readJson(snapshotPath, "System snapshot");
		const wrangler = readJson(wranglerPath, "Wrangler configuration");
		const validation = validateConfigurationCleanupProof(snapshot);

		if (!validation.ok) {
			console.error("Configuration cleanup BLOCKED.");
			printList("Reasons", validation.reasons);
			for (const blocker of validation.proof.migration.blockers) {
				console.error(
					`- ${blocker.code}${blocker.keys.length ? ` [${blocker.keys.join(", ")}]` : ""}`,
				);
			}
			process.exitCode = 3;
		} else {
			const plan = buildWranglerLegacyCleanup(wrangler, snapshot);
			console.log("Configuration cleanup proof: READY");
			printList("Runtime vars to remove", plan.removedRuntimeVars);
			printList("Secure vars found in wrangler", plan.removedSecureVars);
			printList("Deployment vars preserved", plan.preservedDeploymentVars);
			printList("Legacy Worker secrets eligible for manual deletion", plan.manualLegacySecretCleanup);
			printList("Permanent infrastructure secrets to KEEP", plan.permanentInfrastructureSecrets);

			if (args.write) {
				writeJson(wranglerPath, plan.config);
				console.log(`Updated ${wranglerPath}`);
				console.log("No Cloudflare secrets were deleted and no deployment was performed.");
			} else {
				console.log("Dry-run only. Re-run with --write after reviewing this plan.");
			}
		}
	}
} catch (error) {
	console.error(error?.message || String(error));
	process.exitCode = 1;
}
