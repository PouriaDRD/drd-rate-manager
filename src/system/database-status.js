import { APP } from "../config/app.js";
import { HttpClient } from "../clients/http.client.js";
import { errorMessage } from "../utils/core.js";

export async function databaseStatus(services) {
	const started = Date.now();
	let connected = false;
	try {
		await services.env.DB.prepare("SELECT 1 AS ok").first();
		connected = true;
	} catch {
		connected = false;
	}
	const latencyMs = Date.now() - started;
	const tables = [
		"admins",
		"web_admin_users",
		"web_admin_sessions",
		"web_auth_attempts",
		"settings",
		"secure_settings",
		"source_status",
		"coingecko_assets",
		"audit_logs",
		"market_cache",
		"runtime_locks",
		"automation_runs",
	];
	const records = {};
	for (const table of tables) {
		try {
			const row = await services.env.DB.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).first();
			records[table] = Number(row?.count || 0);
		} catch {
			records[table] = 0;
		}
	}
	return {
		connected,
		provider: "Cloudflare D1",
		latency_ms: latencyMs,
		storage: await d1StorageUsage(services),
		records,
		schema_version: APP.schemaVersion,
	};
}

export async function d1StorageUsage(services) {
	const { config } = services;
	const totalMb = config.d1DatabaseLimitMb;
	const accountId = config.cloudflareAccountId;
	const databaseId = config.cloudflareD1DatabaseId;
	const apiToken = config.cloudflareApiToken;
	if (!accountId || !databaseId || !apiToken) {
		return {
			available: false,
			used_mb: 0,
			total_mb: totalMb,
			remaining_mb: totalMb,
			percent: 0,
			bar: "░░░░░░░░░░░░",
		};
	}
	try {
		const response = await new HttpClient().fetch(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`,
			{ headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" } },
			8000,
		);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		const bytes = Number(data?.result?.file_size || 0);
		const usedMb = bytes / 1024 / 1024;
		const percent = totalMb > 0 ? Math.min(100, (usedMb / totalMb) * 100) : 0;
		const filled = Math.round((percent / 100) * 12);
		return {
			available: true,
			used_mb: usedMb,
			total_mb: totalMb,
			remaining_mb: Math.max(0, totalMb - usedMb),
			percent,
			bar: "█".repeat(filled) + "░".repeat(12 - filled),
		};
	} catch (error) {
		return {
			available: false,
			error: errorMessage(error),
			used_mb: 0,
			total_mb: totalMb,
			remaining_mb: totalMb,
			percent: 0,
			bar: "░░░░░░░░░░░░",
		};
	}
}
