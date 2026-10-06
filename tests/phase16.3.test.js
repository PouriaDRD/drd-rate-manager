import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WebAdminAuthController } from "../src/controllers/web-admin-auth.controller.js";
import {
	WebLoginAlertService,
	webLoginAlertDecision,
} from "../src/services/web-login-alert.service.js";

function request({
	userAgent = "Phase16.3-Test",
	ip = "203.0.113.63",
	country = "NL",
	city = "Rotterdam",
	region = "South Holland",
	timezone = "Europe/Amsterdam",
	asn = 64512,
} = {}) {
	const req = new Request("https://example.test/admin/api/v1/auth/login", {
		method: "POST",
		headers: {
			"CF-Connecting-IP": ip,
			"CF-IPCountry": country,
			"CF-Ray": "phase163-ray",
			"User-Agent": userAgent,
			Authorization: "Bearer must-not-leak",
		},
		body: JSON.stringify({ username: "admin", password: "must-not-leak" }),
	});
	Object.defineProperty(req, "cf", {
		value: { country, city, region, timezone, asn },
		configurable: true,
	});
	return req;
}

function harness({
	ownerId = "123456",
	language = "fa",
	sendError = null,
	refreshError = null,
} = {}) {
	const sent = [];
	let refreshes = 0;
	const preferences = {
		telegramLanguage: language,
		async refresh() {
			refreshes += 1;
			if (refreshError) throw refreshError;
		},
	};
	const service = new WebLoginAlertService(
		{ ownerId },
		{
			async sendMessage(chatId, text) {
				if (sendError) throw sendError;
				sent.push({ chatId, text });
				return { message_id: sent.length };
			},
		},
		preferences,
	);
	return {
		service,
		sent,
		get refreshes() {
			return refreshes;
		},
	};
}

test("login alert policy notifies success and fresh lockout without Telegram spam", () => {
	const success = webLoginAlertDecision({
		username: "admin",
		result: "success",
		reason: "authenticated",
		createdAt: 1_800_000_000_000,
	});
	assert.equal(success.notify, true);
	assert.equal(success.kind, "success");
	assert.equal(success.event.username, "admin");
	assert.equal(success.event.createdAt, 1_800_000_000_000);
	assert.equal(
		webLoginAlertDecision({
			username: "admin",
			result: "locked",
			reason: "invalid_credentials_lockout",
		}).notify,
		true,
	);
	assert.equal(
		webLoginAlertDecision({
			username: "admin",
			result: "failure",
			reason: "invalid_credentials",
		}).reason,
		"non_actionable_failure",
	);
	assert.equal(
		webLoginAlertDecision({
			username: "admin",
			result: "locked",
			reason: "rate_limited",
		}).reason,
		"lockout_already_active",
	);
});

test("successful Web Admin login sends one safe Persian owner notification", async () => {
	const h = harness();
	const result = await h.service.notify(request(), {
		username: "pouria",
		result: "success",
		reason: "authenticated",
		sessionRef: "abcdef0123456789",
		createdAt: 1_800_000_000_000,
	});
	assert.deepEqual(result, { action: "sent", reason: "success", sent: true });
	assert.equal(h.sent.length, 1);
	assert.equal(h.sent[0].chatId, "123456");
	assert.match(h.sent[0].text, /ورود موفق به Web Admin/);
	assert.match(h.sent[0].text, /203\.0\.113\.63/);
	assert.match(h.sent[0].text, /Rotterdam/);
	assert.match(h.sent[0].text, /abcdef0123456789/);
	assert.match(h.sent[0].text, /phase163-ray/);
	assert.equal(h.refreshes, 1);
});

test("owner notification follows persisted Telegram language", async () => {
	const h = harness({ language: "en" });
	await h.service.notify(request(), {
		username: "admin",
		result: "success",
		reason: "authenticated",
		createdAt: 1_800_000_000_000,
	});
	assert.match(h.sent[0].text, /Web Admin login/);
	assert.match(h.sent[0].text, /If this login was not yours/);
});

test("fresh lockout sends a red security alert while active lockout attempts stay silent", async () => {
	const h = harness();
	const locked = await h.service.notify(request(), {
		username: "admin",
		result: "locked",
		reason: "invalid_credentials_lockout",
		createdAt: 1_800_000_000_000,
	});
	assert.deepEqual(locked, { action: "sent", reason: "locked", sent: true });
	assert.match(h.sent[0].text, /🔴/);
	assert.match(h.sent[0].text, /invalid_credentials_lockout/);

	const repeated = await h.service.notify(request(), {
		username: "admin",
		result: "locked",
		reason: "rate_limited",
		createdAt: 1_800_000_001_000,
	});
	assert.equal(repeated.reason, "lockout_already_active");
	assert.equal(repeated.sent, false);
	assert.equal(h.sent.length, 1);
});

test("ordinary invalid-password failures never touch Telegram or preferences", async () => {
	const h = harness();
	const result = await h.service.notify(request(), {
		username: "admin",
		result: "failure",
		reason: "invalid_credentials",
		createdAt: 1_800_000_000_000,
	});
	assert.equal(result.reason, "non_actionable_failure");
	assert.equal(result.sent, false);
	assert.equal(h.sent.length, 0);
	assert.equal(h.refreshes, 0);
});

test("missing owner configuration suppresses login alerts before any side effect", async () => {
	const h = harness({ ownerId: "" });
	const result = await h.service.notify(request(), {
		username: "admin",
		result: "success",
		reason: "authenticated",
		createdAt: 1_800_000_000_000,
	});
	assert.equal(result.reason, "owner_missing");
	assert.equal(result.sent, false);
	assert.equal(h.sent.length, 0);
	assert.equal(h.refreshes, 0);
});

test("Telegram or preference failure never replaces the login outcome", async () => {
	const h = harness({
		sendError: new Error("Telegram down"),
		refreshError: new Error("D1 preference read failed"),
	});
	const result = await h.service.notify(request(), {
		username: "admin",
		result: "success",
		reason: "authenticated",
		createdAt: 1_800_000_000_000,
	});
	assert.equal(result.action, "failed");
	assert.equal(result.reason, "telegram_send_failed");
	assert.equal(result.sent, false);
	assert.match(result.error, /Telegram down/);
	assert.equal(h.refreshes, 1);
});

test("login alert HTML escapes untrusted metadata and never copies credentials or authorization", async () => {
	const h = harness();
	await h.service.notify(
		request({ userAgent: "<script>alert('x')</script>", city: "<Rotterdam>" }),
		{
			username: "<admin&>",
			result: "success",
			reason: "authenticated",
			sessionRef: "safe-ref",
			createdAt: 1_800_000_000_000,
			password: "must-not-leak",
			token: "must-not-leak",
		},
	);
	const text = h.sent[0].text;
	assert.doesNotMatch(text, /<script>|<Rotterdam>|<admin&>/);
	assert.match(text, /&lt;script&gt;/);
	assert.match(text, /&lt;Rotterdam&gt;/);
	assert.match(text, /&lt;admin&amp;&gt;/);
	assert.equal(text.includes("must-not-leak"), false);
	assert.equal(text.includes("Bearer"), false);
});

test("Web Admin controller queues security notifications with ExecutionContext waitUntil", async () => {
	const alerts = [];
	const pending = [];
	const services = {
		webAuth: {
			async routingState() {
				return { adminPath: "admin" };
			},
			async login() {
				return {
					ok: true,
					status: 200,
					user: {
						id: 1,
						username: "admin",
						adminPath: "admin",
						mustCompleteBootstrap: false,
						lastLoginAt: 0,
					},
					csrfToken: "csrf",
					cookie: "drd_web_session=x; Path=/; HttpOnly",
					securityEvent: {
						username: "admin",
						result: "success",
						reason: "authenticated",
						sessionRef: "safe-ref",
						createdAt: 1_800_000_000_000,
					},
				};
			},
		},
		webLoginAlerts: {
			async notify(_request, event) {
				alerts.push(event);
			},
		},
	};
	const controller = new WebAdminAuthController(services);
	const req = request();
	const response = await controller.route(req, new URL(req.url), {
		waitUntil(promise) {
			pending.push(promise);
		},
	});
	const payload = await response.json();
	assert.equal(response.status, 200);
	assert.equal(payload.success, true);
	assert.equal(Object.hasOwn(payload, "securityEvent"), false);
	assert.equal(pending.length, 1);
	await pending[0];
	assert.equal(alerts.length, 1);
	assert.equal(alerts[0].sessionRef, "safe-ref");
});

test("controller fail-open fallback preserves successful auth when alert dispatch rejects", async () => {
	const services = {
		webAuth: {
			async routingState() {
				return { adminPath: "admin" };
			},
			async login() {
				return {
					ok: true,
					status: 200,
					user: {
						id: 1,
						username: "admin",
						adminPath: "admin",
						mustCompleteBootstrap: false,
						lastLoginAt: 0,
					},
					csrfToken: "csrf",
					cookie: "drd_web_session=x; Path=/; HttpOnly",
					securityEvent: {
						username: "admin",
						result: "success",
						reason: "authenticated",
						createdAt: 1_800_000_000_000,
					},
				};
			},
		},
		webLoginAlerts: {
			async notify() {
				throw new Error("unexpected alert failure");
			},
		},
	};
	const controller = new WebAdminAuthController(services);
	const req = request();
	const response = await controller.route(req, new URL(req.url));
	assert.equal(response.status, 200);
	assert.equal((await response.json()).success, true);
});

test("Phase 16.3 wiring is background-safe and keeps schema and app version stable", async () => {
	const [container, application, auth, service, appConfig, database] = await Promise.all([
		readFile(new URL("../src/app/container.js", import.meta.url), "utf8"),
		readFile(new URL("../src/app/application.js", import.meta.url), "utf8"),
		readFile(new URL("../src/services/web-auth.service.js", import.meta.url), "utf8"),
		readFile(new URL("../src/services/web-login-alert.service.js", import.meta.url), "utf8"),
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
		readFile(new URL("../src/database/database.js", import.meta.url), "utf8"),
	]);
	assert.equal((container.match(/new WebLoginAlertService\(/g) || []).length, 1);
	assert.match(container, /new WebLoginAlertService\(config, telegram, preferences\)/);
	assert.match(application, /async fetch\(request, ctx = null\)/);
	assert.match(application, /this\.webAdmin\.route\(request, url, ctx\)/);
	assert.match(auth, /securityEvent/);
	assert.doesNotMatch(service, /password|Authorization|TELEGRAM_BOT_TOKEN|tokenHash|csrf/i);
	assert.match(appConfig, /version:\s*"0\.2\.0"/);
	assert.match(appConfig, /schemaVersion:\s*13/);
	assert.equal(
		(database.match(/CREATE TABLE IF NOT EXISTS web_admin_login_history/g) || []).length,
		1,
	);
});
