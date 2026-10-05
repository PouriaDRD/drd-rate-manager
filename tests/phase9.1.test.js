import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AutomationManagementService } from "../src/services/automation-management.service.js";
import { AutomationService } from "../src/services/automation.service.js";

function baseAutomation(overrides = {}) {
	return {
		enabled: true,
		timezone: "UTC",
		intervalMinutes: 5,
		quietHours: { enabled: false, start: "01:00", end: "10:30" },
		scheduleChangedAt: 0,
		lastRunAt: 0,
		lastSuccessAt: 0,
		lastSuccessSlotAt: 0,
		retrySlotAt: 0,
		lastError: "",
		lastTickAt: 0,
		lastAttemptAt: 0,
		lastErrorAt: 0,
		lastSkipReason: "",
		...overrides,
	};
}

function management({ automationState = baseAutomation(), botEnabled = "1" } = {}) {
	const saved = [];
	const runs = [];
	const published = [];
	const released = [];
	const service = new AutomationManagementService(
		{ timezone: "UTC" },
		{
			async get() { return botEnabled; },
			async setMany(values) { saved.push(values); },
		},
		{ async getSettings() { return automationState; } },
		{ async getSnapshot() { return { createdAt: Date.now(), partial: false }; } },
		{ async publish() { published.push(true); return { message_id: 77 }; } },
		{
			buildRichMessage() { return { html: "<b>preview</b>" }; },
			buildFallbackHtml() { return "<b>fallback</b>"; },
		},
		{
			async acquire() { return "token"; },
			async release(key, token) { released.push({ key, token }); },
		},
		{
			async add(row) { runs.push(row); },
			async list() { return [...runs].reverse(); },
		},
	);
	return { service, saved, runs, published, released };
}

test("diagnostics reports disabled bot and automation deterministically", () => {
	const { service } = management();
	const now = Date.UTC(2026, 9, 5, 12, 6);
	assert.equal(service.diagnostics(baseAutomation(), false, now).reason, "bot_disabled");
	assert.equal(
		service.diagnostics(baseAutomation({ enabled: false }), true, now).reason,
		"automation_disabled",
	);
});

test("diagnostics reports waiting, quiet hours, retry and ready states", () => {
	const { service } = management();
	const now = Date.UTC(2026, 9, 5, 12, 6);
	const currentSlot = Date.UTC(2026, 9, 5, 12, 5);
	assert.equal(
		service.diagnostics(baseAutomation({ scheduleChangedAt: Date.UTC(2026, 9, 5, 12, 5, 30) }), true, now).reason,
		"waiting_for_next_slot",
	);
	assert.equal(
		service.diagnostics(baseAutomation({
			quietHours: { enabled: true, start: "12:00", end: "13:00" },
		}), true, now).reason,
		"quiet_hours",
	);
	assert.equal(
		service.diagnostics(baseAutomation({ retrySlotAt: currentSlot }), true, now).reason,
		"retry_pending",
	);
	assert.equal(service.diagnostics(baseAutomation(), true, now).reason, "ready");
});

test("diagnostics reports already published before retry state", () => {
	const { service } = management();
	const now = Date.UTC(2026, 9, 5, 12, 6);
	const currentSlot = Date.UTC(2026, 9, 5, 12, 5);
	const diagnostics = service.diagnostics(
		baseAutomation({ lastSuccessSlotAt: currentSlot, retrySlotAt: currentSlot }),
		true,
		now,
	);
	assert.equal(diagnostics.reason, "already_published");
	assert.equal(diagnostics.canPublishNow, false);
});

test("settings update validates interval and quiet hours", async () => {
	const { service, saved } = management();
	await service.updateSettings({
		enabled: true,
		interval_minutes: 15,
		quiet_hours: { enabled: true, start: "01:15", end: "10:30" },
	});
	assert.deepEqual(saved[0], {
		auto_publish_enabled: "1",
		publish_interval_minutes: 15,
		quiet_hours_enabled: "1",
		quiet_hours_start: "01:15",
		quiet_hours_end: "10:30",
	});
	await assert.rejects(() => service.updateSettings({ interval_minutes: 7 }), /must be one of/);
	await assert.rejects(
		() => service.updateSettings({ quiet_hours: { start: "25:00" } }),
		/HH:MM/,
	);
});

test("dry run builds preview without publishing and writes history", async () => {
	const { service, runs, published } = management();
	const result = await service.dryRun({ actor: { type: "web", id: 1 } });
	assert.equal(result.mode, "dry_run");
	assert.equal(result.fallbackHtml, "<b>fallback</b>");
	assert.equal(published.length, 0);
	assert.equal(runs.length, 1);
	assert.equal(runs[0].status, "preview");
	assert.equal(runs[0].actorId, "1");
});

test("force run bypasses scheduler state, publishes once, records and releases lock", async () => {
	const { service, runs, published, released } = management({
		automationState: baseAutomation({ enabled: false }),
	});
	const result = await service.forceRun({ actor: { type: "web", id: 7 }, refreshMarket: true });
	assert.equal(result.messageId, 77);
	assert.equal(published.length, 1);
	assert.equal(runs[0].mode, "manual");
	assert.equal(runs[0].status, "success");
	assert.equal(released.length, 1);
});

test("scheduled publish writes a success execution record without changing scheduler contract", async () => {
	const now = Date.UTC(2026, 9, 5, 12, 6);
	const rows = {
		bot_enabled: { value: "1", updatedAt: 0 },
		auto_publish_enabled: { value: "1", updatedAt: 0 },
		publish_interval_minutes: { value: "5", updatedAt: 0 },
		quiet_hours_enabled: { value: "0", updatedAt: 0 },
		quiet_hours_start: { value: "01:00", updatedAt: 0 },
		quiet_hours_end: { value: "10:30", updatedAt: 0 },
		auto_publish_last_run_at: { value: String(Date.UTC(2026, 9, 5, 12, 0)), updatedAt: 0 },
		auto_publish_last_success_at: { value: "0", updatedAt: 0 },
		auto_publish_last_success_slot_at: { value: "0", updatedAt: 0 },
		auto_publish_retry_slot_at: { value: "0", updatedAt: 0 },
		auto_publish_last_error: { value: "", updatedAt: 0 },
		auto_publish_last_tick_at: { value: String(now), updatedAt: 0 },
		auto_publish_last_attempt_at: { value: "0", updatedAt: 0 },
		auto_publish_last_error_at: { value: "0", updatedAt: 0 },
		auto_publish_last_skip_reason: { value: "", updatedAt: 0 },
	};
	const history = [];
	const writes = [];
	const service = new AutomationService(
		{},
		{ timezone: "UTC" },
		{
			async getManyWithMeta(keys) {
				return Object.fromEntries(keys.map((key) => [key, rows[key]]));
			},
			async set() {},
			async setMany(values) { writes.push(values); },
		},
		{ async getSnapshot() { return { partial: false }; } },
		{ async publish() { return { message_id: 99 }; } },
		{ async acquire() { return "slot-token"; }, async release() {} },
		{ async add(row) { history.push(row); } },
	);
	await service.tick(now);
	assert.equal(history.length, 1);
	assert.equal(history[0].mode, "scheduled");
	assert.equal(history[0].status, "success");
	assert.equal(history[0].messageId, 99);
	assert.ok(writes.some((row) => row.auto_publish_last_skip_reason === "success"));
});

test("web admin exposes automation settings, diagnostics, dry-run, force-run and history endpoints", async () => {
	const source = await readFile(
		new URL("../src/controllers/web-admin-data.controller.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /api\/v1\/automation`/);
	assert.match(source, /api\/v1\/automation\/settings/);
	assert.match(source, /api\/v1\/automation\/dry-run/);
	assert.match(source, /api\/v1\/automation\/force-run/);
	assert.match(source, /api\/v1\/automation\/history/);
	assert.match(source, /serializeAutomationDiagnostics/);
});

test("schema 11 creates bounded automation execution history storage", async () => {
	const app = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	const database = await readFile(new URL("../src/database/database.js", import.meta.url), "utf8");
	const repository = await readFile(
		new URL("../src/repositories/automation-run.repository.js", import.meta.url),
		"utf8",
	);
	assert.match(app, /schemaVersion: 11/);
	assert.match(database, /CREATE TABLE IF NOT EXISTS automation_runs/);
	assert.match(database, /idx_automation_runs_finished_at/);
	assert.match(repository, /RETAIN_ROWS = 200/);
	assert.match(repository, /RETAIN_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
});

test("composition root wires shared automation run repository into scheduled and management services", async () => {
	const container = await readFile(new URL("../src/app/container.js", import.meta.url), "utf8");
	assert.match(container, /const automationRuns = new AutomationRunRepository/);
	assert.match(container, /new AutomationService\([^;]*automationRuns\)/s);
	assert.match(container, /new AutomationManagementService\([\s\S]*automationRuns/);
});
