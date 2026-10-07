import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	EMPTY_OPERATIONAL_ALERT_STATE,
	OPERATIONAL_ALERT_STATE_KEY,
	OperationalAlertRepository,
} from "../src/repositories/operational-alert.repository.js";
import {
	OPERATIONAL_ALERT_REMINDER_MS,
	OperationalAlertService,
	operationalAlertCandidate,
} from "../src/services/operational-alert.service.js";

function snapshot(status, {
	critical = [],
	warnings = [],
	reasonCodes = [],
	healthScore = 90,
	openCircuits = 0,
} = {}) {
	return {
		health: { status, critical, warnings, reasonCodes },
		sources: { healthScore, openCircuits },
	};
}

function serviceHarness({
	state = EMPTY_OPERATIONAL_ALERT_STATE,
	ownerId = "123",
	language = "fa",
	sendError = null,
	getError = null,
	setError = null,
} = {}) {
	let stored = { ...state };
	const sent = [];
	const writes = [];
	const repository = {
		async get() {
			if (getError) throw getError;
			return { ...stored };
		},
		async set(next) {
			if (setError) throw setError;
			stored = { ...next };
			writes.push({ ...next });
			return stored;
		},
	};
	const service = new OperationalAlertService(
		{ ownerId },
		{
			async sendMessage(chatId, text) {
				if (sendError) throw sendError;
				sent.push({ chatId, text });
				return { message_id: sent.length };
			},
		},
		{ telegramLanguage: language },
		repository,
	);
	return {
		service,
		sent,
		writes,
		get state() { return { ...stored }; },
	};
}

test("critical health produces a stable operational alert fingerprint", () => {
	const candidate = operationalAlertCandidate(
		snapshot("critical", {
			critical: ["runtime_integrity_failed", "database_unavailable"],
		}),
	);
	assert.equal(candidate.severity, "critical");
	assert.deepEqual(candidate.reasons, [
		"database_unavailable",
		"runtime_integrity_failed",
	]);
	assert.equal(
		candidate.fingerprint,
		"critical:database_unavailable,runtime_integrity_failed",
	);
});

test("degraded alerts ignore cache lifecycle noise and keep real route failures actionable", () => {
	const candidate = operationalAlertCandidate(
		snapshot("degraded", {
			warnings: ["sources_unverified", "provider_circuit_open", "cache_expired"],
		}),
	);
	assert.deepEqual(candidate.reasons, ["provider_circuit_open"]);
	assert.equal(
		operationalAlertCandidate(
			snapshot("degraded", { warnings: ["sources_unverified", "cache_expired"] }),
		),
		null,
	);
});

test("first actionable condition sends one owner alert and persists state", async () => {
	const harness = serviceHarness();
	const now = 1_800_000_000_000;
	const result = await harness.service.evaluate(
		snapshot("degraded", { warnings: ["provider_circuit_open"] }),
		now,
	);
	assert.equal(result.action, "alert");
	assert.equal(result.sent, true);
	assert.equal(harness.sent.length, 1);
	assert.equal(harness.sent[0].chatId, "123");
	assert.equal(harness.state.active, true);
	assert.equal(harness.state.lastSentAt, now);
	assert.equal(harness.writes.length, 1);
});

test("same fingerprint is suppressed inside the six-hour reminder window", async () => {
	const now = 1_800_000_000_000;
	const state = {
		active: true,
		fingerprint: "degraded:provider_circuit_open",
		severity: "degraded",
		reasons: ["provider_circuit_open"],
		firstSentAt: now - 1000,
		lastSentAt: now - 1000,
		recoveredAt: 0,
	};
	const harness = serviceHarness({ state });
	const result = await harness.service.evaluate(
		snapshot("degraded", { warnings: ["provider_circuit_open"] }),
		now,
	);
	assert.equal(result.action, "suppressed");
	assert.equal(result.reason, "deduplicated");
	assert.equal(harness.sent.length, 0);
	assert.equal(harness.writes.length, 0);
});

test("same persistent condition sends a reminder after six hours", async () => {
	const now = 1_800_000_000_000;
	const state = {
		active: true,
		fingerprint: "degraded:provider_circuit_open",
		severity: "degraded",
		reasons: ["provider_circuit_open"],
		firstSentAt: now - OPERATIONAL_ALERT_REMINDER_MS,
		lastSentAt: now - OPERATIONAL_ALERT_REMINDER_MS,
		recoveredAt: 0,
	};
	const harness = serviceHarness({ state, language: "en" });
	const result = await harness.service.evaluate(
		snapshot("degraded", { warnings: ["provider_circuit_open"] }),
		now,
	);
	assert.equal(result.action, "reminder");
	assert.equal(harness.sent.length, 1);
	assert.match(harness.sent[0].text, /Operational alert reminder/);
	assert.equal(harness.state.firstSentAt, state.firstSentAt);
	assert.equal(harness.state.lastSentAt, now);
});

test("changed alert fingerprint sends a new alert immediately", async () => {
	const now = 1_800_000_000_000;
	const state = {
		active: true,
		fingerprint: "degraded:provider_circuit_open",
		severity: "degraded",
		reasons: ["provider_circuit_open"],
		firstSentAt: now - 5000,
		lastSentAt: now - 1000,
		recoveredAt: 0,
	};
	const harness = serviceHarness({ state });
	const result = await harness.service.evaluate(
		snapshot("critical", { critical: ["runtime_integrity_failed"] }),
		now,
	);
	assert.equal(result.action, "alert");
	assert.equal(harness.sent.length, 1);
	assert.equal(harness.state.severity, "critical");
	assert.equal(
		harness.state.fingerprint,
		"critical:runtime_integrity_failed",
	);
	assert.equal(harness.state.firstSentAt, now);
});

test("healthy state after an active incident sends one recovery notification", async () => {
	const now = 1_800_000_000_000;
	const harness = serviceHarness({
		state: {
			active: true,
			fingerprint: "degraded:cache_expired",
			severity: "degraded",
			reasons: ["cache_expired"],
			firstSentAt: now - 10000,
			lastSentAt: now - 5000,
			recoveredAt: 0,
		},
		language: "en",
	});
	const result = await harness.service.evaluate(snapshot("healthy"), now);
	assert.equal(result.action, "recovery");
	assert.equal(harness.sent.length, 1);
	assert.match(harness.sent[0].text, /System recovered/);
	assert.equal(harness.state.active, false);
	assert.equal(harness.state.recoveredAt, now);

	const second = await harness.service.evaluate(snapshot("healthy"), now + 1000);
	assert.equal(second.action, "none");
	assert.equal(harness.sent.length, 1);
});

test("disabled system neither alerts nor clears an existing active incident", async () => {
	const now = 1_800_000_000_000;
	const initial = {
		active: true,
		fingerprint: "degraded:cache_expired",
		severity: "degraded",
		reasons: ["cache_expired"],
		firstSentAt: now - 10000,
		lastSentAt: now - 5000,
		recoveredAt: 0,
	};
	const harness = serviceHarness({ state: initial });
	const result = await harness.service.evaluate(snapshot("disabled"), now);
	assert.equal(result.action, "suppressed");
	assert.equal(result.reason, "system_disabled");
	assert.equal(harness.sent.length, 0);
	assert.deepEqual(harness.state, initial);
});

test("owner missing and alert-state storage failure both fail closed without sending", async () => {
	const missingOwner = serviceHarness({ ownerId: "" });
	const result1 = await missingOwner.service.evaluate(
		snapshot("critical", { critical: ["runtime_integrity_failed"] }),
	);
	assert.equal(result1.reason, "owner_missing");
	assert.equal(missingOwner.sent.length, 0);

	const brokenState = serviceHarness({ getError: new Error("D1 down") });
	const result2 = await brokenState.service.evaluate(
		snapshot("critical", { critical: ["runtime_integrity_failed"] }),
	);
	assert.equal(result2.reason, "state_unavailable");
	assert.equal(brokenState.sent.length, 0);
});

test("Telegram send failure does not mark alert as delivered", async () => {
	const harness = serviceHarness({ sendError: new Error("Telegram down") });
	const result = await harness.service.evaluate(
		snapshot("degraded", { warnings: ["source_failures"] }),
	);
	assert.equal(result.action, "failed");
	assert.equal(result.reason, "telegram_send_failed");
	assert.equal(harness.writes.length, 0);
	assert.equal(harness.state.active, false);
});

test("operational alert repository persists normalized state in existing settings storage", async () => {
	const values = new Map();
	const repository = new OperationalAlertRepository({
		async get(key, fallback) {
			return values.has(key) ? values.get(key) : fallback;
		},
		async set(key, value) {
			values.set(key, value);
		},
	});
	assert.deepEqual(await repository.get(), { ...EMPTY_OPERATIONAL_ALERT_STATE });
	await repository.set({
		active: true,
		fingerprint: "critical:x",
		severity: "critical",
		reasons: ["x"],
		firstSentAt: 10,
		lastSentAt: 20,
		recoveredAt: 0,
	});
	assert.ok(values.has(OPERATIONAL_ALERT_STATE_KEY));
	const restored = await repository.get();
	assert.equal(restored.active, true);
	assert.equal(restored.fingerprint, "critical:x");
	assert.deepEqual(restored.reasons, ["x"]);
});

test("lightweight database diagnostics bypass storage API and table-count path", async () => {
	const source = await readFile(
		new URL("../src/system/database-status.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /databaseStatus\(services, \{ details = true \} = \{\}\)/);
	assert.match(source, /if \(!details\)/);
	const detailGuard = source.indexOf("if (!details)");
	const tables = source.indexOf("const tables = [");
	const storage = source.indexOf("storage: await d1StorageUsage");
	assert.ok(detailGuard >= 0 && detailGuard < tables && tables < storage);
});

test("SystemManagement exposes a lightweight health snapshot without admin or provider refresh calls", async () => {
	const source = await readFile(
		new URL("../src/services/system-management.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /async healthSnapshot\(now = Date\.now\(\)\)/);
	assert.match(source, /databaseStatusFn\(this\.s, \{ details: false \}\)/);
	const method = source.slice(
		source.indexOf("async healthSnapshot"),
		source.indexOf("async snapshot"),
	);
	assert.doesNotMatch(method, /adminManagement/);
	assert.doesNotMatch(method, /forceRefresh|fetchMarketBundle|checkWallex|checkTabdeal|checkExir/);
});

test("scheduled execution evaluates alerts after both success and failure without replacing cron errors", async () => {
	const source = await readFile(new URL("../src/app/application.js", import.meta.url), "utf8");
	assert.match(source, /await this\.services\.operationalAlerts\.evaluate\(snapshot\)/);
	assert.match(source, /catch \(error\) \{\s*await this\.#evaluateOperationalAlerts\(\);\s*throw error;/);
	assert.match(source, /result = await this\.services\.automation\.tick\(\)/);
	assert.match(source, /event: "operational_alert\.check_failed"/);
});

test("Web and Telegram System surfaces expose persistent alert status", async () => {
	const [controller, html, web, telegram] = await Promise.all([
		readFile(new URL("../src/controllers/web-admin-system.controller.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8"),
		readFile(new URL("../src/controllers/telegram/telegram-system.methods.js", import.meta.url), "utf8"),
	]);
	assert.match(controller, /alerts: \{/);
	assert.match(controller, /last_sent_at: isoOrNull\(snapshot\.alerts\?\.lastSentAt\)/);
	assert.match(html, /system-alert-state/);
	assert.match(html, /system-alert-last/);
	assert.match(web, /renderMetrics\(data\.metrics \|\| \{\}, data\.alerts \|\| \{\}\)/);
	assert.match(web, /alertNotConfigured/);
	assert.doesNotMatch(web, /\.innerHTML\s*=/);
	assert.match(telegram, /Operational alerts/);
	assert.match(telegram, /const alerts = snapshot\.alerts \|\| \{\}/);
});

test("Phase 14.3 reuses existing storage and keeps schema/version stable", async () => {
	const [repo, app] = await Promise.all([
		readFile(new URL("../src/repositories/operational-alert.repository.js", import.meta.url), "utf8"),
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
	]);
	assert.doesNotMatch(repo, /CREATE TABLE|ALTER TABLE/);
	assert.match(repo, /this\.settings\.get/);
	assert.match(repo, /this\.settings\.set/);
	assert.match(app, /version:\s*"0\.2\.1"/);
	assert.match(app, /schemaVersion:\s*13/);
});
