import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AutomationRunRepository } from "../src/repositories/automation-run.repository.js";
import {
	OPERATIONAL_METRICS_WINDOW_HOURS,
	OPERATIONAL_METRICS_WINDOW_MS,
	buildOperationalMetrics,
} from "../src/services/operational-metrics.js";

test("operational metrics use a deterministic 24-hour window", () => {
	assert.equal(OPERATIONAL_METRICS_WINDOW_HOURS, 24);
	assert.equal(OPERATIONAL_METRICS_WINDOW_MS, 24 * 60 * 60 * 1000);
});

test("automation repository aggregates existing history without adding writes", async () => {
	let sql = "";
	let bound = [];
	const repository = new AutomationRunRepository({
		DB: {
			prepare(statement) {
				sql = statement;
				return {
					bind(...values) {
						bound = values;
						return this;
					},
					async first() {
						return {
							total: 10,
							success_count: 8,
							error_count: 2,
							partial_count: 3,
							average_duration_ms: 125.5,
							last_success_at: 1800,
							last_error_at: 1700,
						};
					},
				};
			},
		},
	});
	const stats = await repository.stats(1000, 2000);
	assert.match(sql, /FROM automation_runs/);
	assert.match(sql, /COUNT\(\*\)/);
	assert.match(sql, /AVG\(CASE/);
	assert.deepEqual(bound, [1000, 2000]);
	assert.deepEqual(stats, {
		total: 10,
		successCount: 8,
		errorCount: 2,
		partialCount: 3,
		averageDurationMs: 125.5,
		lastSuccessAt: 1800,
		lastErrorAt: 1700,
	});
});

test("metrics compute success error and partial percentages", () => {
	const now = 1_800_000_000_000;
	const metrics = buildOperationalMetrics({
		now,
		automation: {
			supported: true,
			available: true,
			total: 10,
			successCount: 8,
			errorCount: 2,
			partialCount: 3,
			averageDurationMs: 125.5,
			lastSuccessAt: now - 1000,
			lastErrorAt: now - 2000,
		},
		database: { connected: true, latency_ms: 12 },
		cache: { present: true, fresh: true, ageSeconds: 5, lastError: null },
		sources: {
			enabled: 5,
			healthy: 4,
			failed: 1,
			unchecked: 0,
			healthScore: 88,
			healthGrade: "excellent",
			openCircuits: 1,
		},
		health: { status: "degraded", reasonCodes: ["provider_circuit_open"] },
	});
	assert.equal(metrics.automation.successRate, 80);
	assert.equal(metrics.automation.errorRate, 20);
	assert.equal(metrics.automation.partialRate, 30);
	assert.equal(metrics.automation.averageDurationMs, 126);
	assert.equal(metrics.providers.healthScore, 88);
	assert.equal(metrics.database.latencyMs, 12);
	assert.equal(metrics.system.reasonCount, 1);
});

test("empty automation window reports null rates rather than false zero percentages", () => {
	const metrics = buildOperationalMetrics({
		automation: { supported: true, available: true, total: 0 },
	});
	assert.equal(metrics.automation.totalRuns, 0);
	assert.equal(metrics.automation.successRate, null);
	assert.equal(metrics.automation.errorRate, null);
	assert.equal(metrics.automation.partialRate, null);
});

test("SystemManagement reads history metrics without provider refreshes", async () => {
	const source = await readFile(
		new URL("../src/services/system-management.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /automationMetricStats\(this\.s\.automationRuns, now\)/);
	assert.match(source, /buildOperationalMetrics/);
	assert.doesNotMatch(source, /forceRefresh|fetchMarketBundle|checkWallex|checkTabdeal|checkExir/);
});

test("metric collection failure is bounded and becomes a health warning", async () => {
	const source = await readFile(
		new URL("../src/services/system-management.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /operational_metrics_unavailable/);
	assert.match(source, /errorMessage\(error\)\.slice\(0, 500\)/);
});

test("composition reuses existing AutomationRunRepository instead of adding storage", async () => {
	const source = await readFile(new URL("../src/app/container.js", import.meta.url), "utf8");
	assert.equal((source.match(/new AutomationRunRepository\(runtimeEnv\)/g) || []).length, 1);
	assert.match(source, /automationRuns,[\s\S]*automationManagement/);
});

test("Web Admin System API serializes operational metrics", async () => {
	const source = await readFile(
		new URL("../src/controllers/web-admin-system.controller.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /window_hours: snapshot\.metrics\?\.windowHours/);
	assert.match(source, /success_rate: snapshot\.metrics\?\.automation\?\.successRate/);
	assert.match(source, /average_duration_ms:/);
	assert.match(source, /health_score: snapshot\.metrics\?\.providers\?\.healthScore/);
});

test("Web Admin System renders the metrics panel with safe text primitives", async () => {
	const [html, js] = await Promise.all([
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /system-metrics-total-runs/);
	assert.match(html, /system-metrics-success-rate/);
	assert.match(js, /function renderMetrics\(metrics, alerts\)/);
	assert.match(js, /setText\("system-metrics-total-runs"/);
	assert.doesNotMatch(js, /\.innerHTML\s*=/);
});

test("Telegram System renders the same 24-hour automation metrics", async () => {
	const source = await readFile(
		new URL("../src/controllers/telegram/telegram-system.methods.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /Automation 24h/);
	assert.match(source, /automationMetrics\.totalRuns/);
	assert.match(source, /automationMetrics\.successRate/);
	assert.match(source, /operational_metrics_unavailable/);
});

test("Phase 14.2 adds no schema or application version bump", async () => {
	const app = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(app, /version:\s*"0\.13\.0"/);
	assert.match(app, /schemaVersion:\s*13/);
});

test("operational metrics service contains no D1 or provider network calls", async () => {
	const source = await readFile(
		new URL("../src/services/operational-metrics.js", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /\.prepare\(/);
	assert.doesNotMatch(source, /\.fetch\(/);
});
