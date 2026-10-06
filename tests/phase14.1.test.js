import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	OperationalLogger,
	redactOperationalValue,
	withRequestId,
} from "../src/observability/operational-logger.js";

function captureConsole() {
	const entries = [];
	return {
		entries,
		consoleRef: {
			log(value) { entries.push({ level: "log", value }); },
			warn(value) { entries.push({ level: "warn", value }); },
			error(value) { entries.push({ level: "error", value }); },
		},
	};
}

test("structured logger emits deterministic HTTP start and completion records", () => {
	const capture = captureConsole();
	let now = 1_800_000_000_000;
	const logger = new OperationalLogger({
		consoleRef: capture.consoleRef,
		now: () => now,
		idFactory: () => "req-123",
	});
	const request = new Request("https://example.test/api/v1/market?token=should-not-log", {
		method: "GET",
		headers: { "cf-ray": "ray-abc" },
	});
	const operation = logger.beginHttp(request);
	logger.start(operation);
	now += 27;
	logger.complete(operation, { status: 200 });

	assert.equal(capture.entries.length, 2);
	assert.equal(capture.entries[0].value.event, "http.start");
	assert.equal(capture.entries[0].value.operationId, "req-123");
	assert.equal(capture.entries[0].value.path, "/api/v1/market");
	assert.equal(JSON.stringify(capture.entries[0].value).includes("should-not-log"), false);
	assert.equal(capture.entries[1].value.event, "http.complete");
	assert.equal(capture.entries[1].value.status, 200);
	assert.equal(capture.entries[1].value.durationMs, 27);
});

test("scheduled operations share one correlation id across start and failure", () => {
	const capture = captureConsole();
	let now = 1_800_000_000_000;
	const logger = new OperationalLogger({
		consoleRef: capture.consoleRef,
		now: () => now,
		idFactory: () => "cron-123",
	});
	const operation = logger.beginScheduled();
	logger.start(operation);
	now += 11;
	logger.fail(operation, new Error("provider failed"));

	assert.equal(capture.entries[0].value.operationId, "cron-123");
	assert.equal(capture.entries[1].value.operationId, "cron-123");
	assert.equal(capture.entries[1].value.event, "cron.error");
	assert.equal(capture.entries[1].value.durationMs, 11);
	assert.equal(capture.entries[1].value.error.message, "provider failed");
});

test("operational redaction strips nested credentials and session material", () => {
	const result = redactOperationalValue({
		token: "abc",
		password: "secret",
		nested: {
			api_key: "key",
			authorization: "Bearer value",
			cookie: "sid=x",
			safe: "visible",
		},
	});
	assert.equal(result.token, "[redacted]");
	assert.equal(result.password, "[redacted]");
	assert.equal(result.nested.api_key, "[redacted]");
	assert.equal(result.nested.authorization, "[redacted]");
	assert.equal(result.nested.cookie, "[redacted]");
	assert.equal(result.nested.safe, "visible");
});

test("logger bounds very large strings and collection sizes", () => {
	const result = redactOperationalValue({
		message: "x".repeat(5000),
		items: Array.from({ length: 100 }, (_, index) => index),
	});
	assert.ok(result.message.length <= 1001);
	assert.equal(result.items.length, 25);
});

test("withRequestId preserves response status body and existing headers", async () => {
	const response = new Response("ok", {
		status: 202,
		headers: { "Cache-Control": "no-store" },
	});
	const traced = withRequestId(response, "req-xyz");
	assert.equal(traced.status, 202);
	assert.equal(await traced.text(), "ok");
	assert.equal(traced.headers.get("Cache-Control"), "no-store");
	assert.equal(traced.headers.get("X-Request-Id"), "req-xyz");
});

test("entrypoint uses structured lifecycle logging instead of ad-hoc unhandled logs", async () => {
	const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
	assert.match(source, /new OperationalLogger\(\)/);
	assert.match(source, /operations\.beginHttp\(request\)/);
	assert.match(source, /operations\.complete\(operation/);
	assert.match(source, /operations\.fail\(operation, error\)/);
	assert.match(source, /withRequestId\(response, operation\.id\)/);
	assert.match(source, /operations\.beginScheduled\(\)/);
	assert.doesNotMatch(source, /http\.unhandled_error/);
	assert.doesNotMatch(source, /cron\.unhandled_error/);
});

test("HTTP observability logs pathname only and never request headers or body", async () => {
	const source = await readFile(
		new URL("../src/observability/operational-logger.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /new URL\(request\.url\)\.pathname/);
	assert.doesNotMatch(source, /request\.text\(/);
	assert.doesNotMatch(source, /request\.json\(/);
	assert.doesNotMatch(source, /Object\.fromEntries\(request.*headers/i);
});

test("Phase 14.1 adds no D1 writes, schema bump or app-version bump", async () => {
	const [loggerSource, appSource] = await Promise.all([
		readFile(new URL("../src/observability/operational-logger.js", import.meta.url), "utf8"),
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
	]);
	assert.doesNotMatch(loggerSource, /\.prepare\(/);
	assert.match(appSource, /version:\s*"0\.13\.0"/);
	assert.match(appSource, /schemaVersion:\s*12/);
});
