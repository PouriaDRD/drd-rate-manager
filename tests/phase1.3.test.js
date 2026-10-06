import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import { Application } from "../src/app/application.js";
import { createServices } from "../src/app/container.js";
import { runtimeIntegrity } from "../src/app/runtime-integrity.js";
import { ApiController } from "../src/controllers/api.controller.js";
import { TelegramController } from "../src/controllers/telegram.controller.js";

function responseJson(response) {
	return response.json();
}

function fakeStatement() {
	return {
		bind() { return this; },
		async first() { return { count: 0, ok: 1 }; },
		async all() { return { results: [] }; },
		async run() { return { meta: { changes: 1 } }; },
	};
}

function fakeDb() {
	return {
		prepare() { return fakeStatement(); },
		async batch(statements) {
			return Promise.all(statements.map((statement) => statement.run?.() ?? null));
		},
	};
}

test("phase 1.3 exposes modular runtime contracts", () => {
	assert.equal(typeof Application, "function");
	assert.equal(typeof ApiController, "function");
	assert.equal(typeof TelegramController, "function");
	assert.equal(typeof createServices, "function");
	assert.equal(typeof worker.fetch, "function");
	assert.equal(typeof worker.scheduled, "function");
	assert.equal(runtimeIntegrity(), true);
});

test("composition root wires shared services", () => {
	const env = { DB: fakeDb() };
	const services = createServices(env);
	assert.equal(services.rawEnv, env);
	assert.equal(services.env.DB, env.DB);
	assert.equal(services.market.settings, services.settings);
	assert.equal(services.market.cache, services.cache);
	assert.equal(services.market.sources, services.sources);
	assert.equal(services.publisher.telegram, services.telegram);
	assert.equal(services.automation.market, services.market);
	assert.equal(services.automation.publisher, services.publisher);
});

test("API root keeps the existing endpoint contract", async () => {
	const services = {
		config: { env: {}, version: "0.2.0", timezone: "Asia/Tehran" },
	};
	const controller = new ApiController(services);
	const response = await controller.route(
		new Request("https://example.test/", { method: "GET" }),
		new URL("https://example.test/"),
	);
	assert.equal(response.status, 200);
	const payload = await responseJson(response);
	assert.equal(payload.success, true);
	assert.equal(payload.version, "0.2.0");
	assert.equal(payload.endpoints.market, "/api/v1/market");
	assert.equal(payload.endpoints.database, "/api/v1/system/database");
});

test("API OPTIONS keeps CORS contract", async () => {
	const controller = new ApiController({});
	const response = await controller.route(
		new Request("https://example.test/api/v1/market", { method: "OPTIONS" }),
		new URL("https://example.test/api/v1/market"),
	);
	assert.equal(response.status, 204);
	assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});

test("Telegram webhook rejects an invalid configured secret before parsing the update", async () => {
	const controller = new TelegramController({
		config: { telegramWebhookSecret: "expected" },
	});
	const response = await controller.handleWebhook(
		new Request("https://example.test/telegram/webhook", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "wrong" },
			body: JSON.stringify({}),
		}),
	);
	assert.equal(response.status, 401);
	assert.deepEqual(await responseJson(response), { success: false, message: "Unauthorized" });
});

test("worker entrypoint returns a controlled 500 when D1 binding is missing", async () => {
	const response = await worker.fetch(new Request("https://example.test/"), {}, {});
	assert.equal(response.status, 500);
	const payload = await responseJson(response);
	assert.equal(payload.success, false);
	assert.match(payload.error, /D1 binding/);
});

test("worker entrypoint serves the API root through the modular Application", async () => {
	const env = {
		DB: fakeDb(),
		APP_NAME: "DRD RATE MANAGER",
		APP_VERSION: "0.2.0",
		TIMEZONE: "Asia/Tehran",
	};
	const response = await worker.fetch(new Request("https://example.test/"), env, {});
	assert.equal(response.status, 200);
	const payload = await responseJson(response);
	assert.equal(payload.success, true);
	assert.equal(payload.service, "DRD RATE MANAGER");
	assert.equal(payload.version, "0.2.0");
});
