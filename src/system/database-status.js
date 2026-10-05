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
		"settings",
		"source_status",
		"coingecko_assets",
		"audit_logs",
		"market_cache",
		"runtime_locks",
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
	const { env } = services;
	const totalMb = Number(env.D1_DATABASE_LIMIT_MB || 500);
	if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_D1_DATABASE_ID || !env.CLOUDFLARE_API_TOKEN) {
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
			`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.CLOUDFLARE_D1_DATABASE_ID}`,
			{ headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, Accept: "application/json" } },
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
