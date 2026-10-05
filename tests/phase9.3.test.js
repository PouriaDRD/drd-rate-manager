import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { telegram_settingsMethods } from "../src/controllers/telegram/telegram-settings.methods.js";

function fakeMessage() {
	return { chat: { id: 1 }, message_id: 2 };
}

function automationState(overrides = {}) {
	return {
		botEnabled: true,
		settings: {
			enabled: true,
			intervalMinutes: 10,
			quietHours: { enabled: false, start: "01:00", end: "10:30" },
			lastSuccessAt: 0,
			lastError: "",
			...overrides.settings,
		},
		diagnostics: {
			reason: "ready",
			nextPublishAt: Date.UTC(2026, 9, 5, 12, 10),
			retryPending: false,
			...overrides.diagnostics,
		},
		history: [],
	};
}

function controller({ language = "en", state = automationState() } = {}) {
	const edits = [];
	const dryRuns = [];
	const forceRuns = [];
	const ctx = {
		s: {
			config: { timezone: "UTC" },
			automationManagement: {
				async state() { return state; },
				async history() { return []; },
				async dryRun(input) {
					dryRuns.push(input);
					return { partial: false, fallbackHtml: "<b>preview</b>" };
				},
				async forceRun(input) {
					forceRuns.push(input);
					return { messageId: 123, partial: false };
				},
			},
			telegram: {
				async editMessage(...args) {
					edits.push(args);
					return args;
				},
			},
		},
		_tgLanguage() { return language; },
		_tg() { return "Settings"; },
		...telegram_settingsMethods,
	};
	return { ctx, edits, dryRuns, forceRuns };
}

test("Telegram automation home uses shared management state and exposes Phase 9.3 actions", async () => {
	const { ctx, edits } = controller();
	await ctx._showAutomation(fakeMessage());
	const [, , text, options] = edits[0];
	assert.match(text, /Publishing automation/);
	assert.match(text, /Ready/);
	const callbacks = options.inline_keyboard.flat().map((button) => button.callback_data);
	for (const expected of [
		"automation:dry-run",
		"automation:force:confirm",
		"automation:history",
		"automation:refresh",
		"automation:quiet:toggle",
	]) {
		assert.ok(callbacks.includes(expected), expected);
	}
});

test("Telegram dry run is non-publishing and records Telegram actor context", async () => {
	const { ctx, edits, dryRuns } = controller();
	await ctx._showAutomationDryRun(fakeMessage(), { id: 99 });
	assert.deepEqual(dryRuns[0], {
		actor: { type: "telegram", id: 99 },
		refreshMarket: false,
	});
	assert.match(edits[0][2], /Nothing was published/);
	assert.match(edits[0][2], /&lt;b&gt;preview&lt;\/b&gt;/);
});

test("Telegram force run requires a separate confirmation screen", async () => {
	const { ctx, edits, forceRuns } = controller();
	await ctx._confirmAutomationForceRun(fakeMessage());
	assert.equal(forceRuns.length, 0);
	assert.match(edits[0][2], /bypasses the scheduler/i);
	assert.equal(
		edits[0][3].inline_keyboard[0][0].callback_data,
		"automation:force:execute",
	);
});

test("confirmed Telegram force run uses shared management service and Telegram actor", async () => {
	const { ctx, edits, forceRuns } = controller();
	await ctx._executeAutomationForceRun(fakeMessage(), { id: 77 });
	assert.deepEqual(forceRuns[0], {
		actor: { type: "telegram", id: 77 },
		refreshMarket: false,
	});
	assert.match(edits[0][2], /Message ID/);
	assert.match(edits[0][2], /123/);
});

test("automation diagnostics reasons have deterministic FA and EN labels", () => {
	const { ctx } = controller();
	assert.equal(ctx._automationReasonText("ready", true), "Ready");
	assert.equal(ctx._automationReasonText("ready", false), "آماده انتشار");
	assert.equal(ctx._automationReasonText("retry_pending", true), "Retry pending");
	assert.equal(ctx._automationReasonText("quiet_hours", false), "ساعت استراحت");
});

test("Telegram history safely renders recent executions", async () => {
	const { ctx, edits } = controller();
	ctx.s.automationManagement.history = async () => [{
		mode: "manual",
		status: "success",
		finishedAt: Date.UTC(2026, 9, 5, 12, 0),
		actorType: "telegram",
		actorId: "55",
	}];
	await ctx._showAutomationHistory(fakeMessage());
	assert.match(edits[0][2], /Automation history/);
	assert.match(edits[0][2], /Manual force run/);
	assert.match(edits[0][2], /Telegram · 55/);
});

test("Telegram callback routing uses AutomationManagementService for shared settings", async () => {
	const core = await readFile(
		new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url),
		"utf8",
	);
	assert.match(core, /automationManagement\.updateSettings/);
	assert.match(core, /automationManagement\.state/);
	assert.match(core, /automation:dry-run/);
	assert.match(core, /automation:force:confirm/);
	assert.match(core, /automation:force:execute/);
	assert.match(core, /automation:history/);
});

test("Telegram interval and quiet-hour writes no longer bypass management validation", async () => {
	const core = await readFile(
		new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url),
		"utf8",
	);
	const automationBlock = core.slice(
		core.indexOf('if (data === "automation:home"'),
		core.indexOf('if (data === "system:home"'),
	);
	assert.doesNotMatch(automationBlock, /this\.s\.settings\.set\("publish_interval_minutes"/);
	assert.doesNotMatch(automationBlock, /this\.s\.settings\.setMany/);
	assert.match(automationBlock, /quiet_hours:/);
});

test("Phase 9.3 keeps Telegram automation copy bilingual", async () => {
	const { ctx: fa, edits: faEdits } = controller({ language: "fa" });
	await fa._showAutomation(fakeMessage());
	assert.match(faEdits[0][2], /اتوماسیون انتشار/);
	assert.match(faEdits[0][2], /آماده انتشار/);

	const { ctx: en, edits: enEdits } = controller({ language: "en" });
	await en._showAutomation(fakeMessage());
	assert.match(enEdits[0][2], /Publishing automation/);
	assert.match(enEdits[0][2], /Ready/);
});

test("Phase 9.3 does not modify Web Admin Phase 9.2 assets", async () => {
	const api = await readFile(new URL("../public/admin/assets/api.js", import.meta.url), "utf8");
	const app = await readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8");
	assert.match(api, /automationForceRun/);
	assert.match(app, /renderAutomationHistory/);
});
