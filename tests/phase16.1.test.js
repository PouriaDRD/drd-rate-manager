import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	LoginHistoryService,
	WEB_LOGIN_RESULTS,
	webLoginRequestMetadata,
} from "../src/services/login-history.service.js";
import { WebAuthService } from "../src/services/web-auth.service.js";

class FakeHistoryRepository {
	constructor() {
		this.rows = [];
	}
	async create(record) {
		this.rows.push({ ...record, id: this.rows.length + 1 });
		return { ...this.rows.at(-1) };
	}
	async list({ limit = 50, offset = 0, result = null } = {}) {
		const rows = result
			? this.rows.filter((item) => item.result === result)
			: this.rows;
		return rows.slice(offset, offset + limit).map((item) => ({ ...item }));
	}
	async stats() {
		return {
			total: this.rows.length,
			success: this.rows.filter((item) => item.result === "success").length,
			failure: this.rows.filter((item) => item.result === "failure").length,
			locked: this.rows.filter((item) => item.result === "locked").length,
		};
	}
}

function fakeRequest({
	ip = "203.0.113.50",
	userAgent = "Phase16-Test/1.0",
	cfRay = "abc123-AMS",
	country = "NL",
	region = "South Holland",
	city = "Rotterdam",
	timezone = "Europe/Amsterdam",
	asn = 64512,
} = {}) {
	const headers = new Headers({
		"CF-Connecting-IP": ip,
		"User-Agent": userAgent,
		"CF-Ray": cfRay,
		"CF-IPCountry": country,
	});
	return {
		headers,
		cf: { country, region, city, timezone, asn },
	};
}

test("login history result vocabulary is explicit and bounded", () => {
	assert.deepEqual(WEB_LOGIN_RESULTS, {
		SUCCESS: "success",
		FAILURE: "failure",
		LOCKED: "locked",
	});
});

test("Cloudflare request metadata captures bounded security context", () => {
	const metadata = webLoginRequestMetadata(fakeRequest());
	assert.deepEqual(metadata, {
		ipAddress: "203.0.113.50",
		userAgent: "Phase16-Test/1.0",
		cfRay: "abc123-AMS",
		country: "NL",
		region: "South Holland",
		city: "Rotterdam",
		timezone: "Europe/Amsterdam",
		asn: 64512,
	});
});

test("metadata gracefully degrades when Cloudflare geolocation is unavailable", () => {
	const request = {
		headers: new Headers({
			"X-Forwarded-For": "198.51.100.9, 10.0.0.1",
			"User-Agent": "Fallback",
		}),
	};
	const metadata = webLoginRequestMetadata(request);
	assert.equal(metadata.ipAddress, "198.51.100.9");
	assert.equal(metadata.userAgent, "Fallback");
	assert.equal(metadata.cfRay, "");
	assert.equal(metadata.country, "");
	assert.equal(metadata.region, "");
	assert.equal(metadata.city, "");
	assert.equal(metadata.timezone, "");
	assert.equal(metadata.asn, null);
});

test("LoginHistoryService persists safe normalized records", async () => {
	const repository = new FakeHistoryRepository();
	const service = new LoginHistoryService(repository, { now: () => 123456 });
	const record = await service.record(fakeRequest(), {
		userId: 1,
		username: "ADMIN",
		result: "success",
		reason: "authenticated",
		sessionRef: "abcdef0123456789",
	});
	assert.equal(record.userId, 1);
	assert.equal(record.result, "success");
	assert.equal(record.reason, "authenticated");
	assert.equal(record.sessionRef, "abcdef0123456789");
	assert.equal(record.createdAt, 123456);
	assert.equal(repository.rows.length, 1);
});

test("LoginHistoryService rejects unknown result values before repository access", async () => {
	const repository = new FakeHistoryRepository();
	const service = new LoginHistoryService(repository);
	await assert.rejects(
		() =>
			service.record(fakeRequest(), {
				username: "admin",
				result: "maybe",
				reason: "test",
			}),
		/Invalid web login history result/,
	);
	assert.equal(repository.rows.length, 0);
});

test("login history service exposes reusable list and stats for later Web/Telegram surfaces", async () => {
	const repository = new FakeHistoryRepository();
	const service = new LoginHistoryService(repository, { now: () => 1 });
	await service.record(fakeRequest(), {
		username: "admin",
		result: "success",
		reason: "authenticated",
	});
	await service.record(fakeRequest(), {
		username: "admin",
		result: "failure",
		reason: "invalid_credentials",
	});
	assert.equal((await service.list()).length, 2);
	assert.deepEqual(await service.stats(), {
		total: 2,
		success: 1,
		failure: 1,
		locked: 0,
	});
});

class FakeHasher {
	async verify(password, record) {
		return record?.password_hash === `hash:${password}`;
	}
	async hash(password) {
		return {
			passwordHash: `hash:${password}`,
			passwordSalt: "salt",
			passwordAlgorithm: "PBKDF2-HMAC-SHA256",
			passwordIterations: 600_000,
		};
	}
}

class FakeUsers {
	constructor() {
		this.user = {
			id: 1,
			username: "admin",
			password_hash: "hash:admin",
			password_salt: "salt",
			password_algorithm: "PBKDF2-HMAC-SHA256",
			password_iterations: 600_000,
			admin_path: "admin",
			must_complete_bootstrap: 1,
			credential_version: 1,
			last_login_at: 0,
		};
	}
	async getPrimary() { return { ...this.user }; }
	async getByUsername(username) {
		return username === this.user.username ? { ...this.user } : null;
	}
	async touchLogin(_id, now) { this.user.last_login_at = now; }
}

class FakeSessions {
	constructor() { this.rows = []; }
	async pruneExpired() {}
	async create(record) { this.rows.push({ ...record }); }
}

class FakeAttempts {
	constructor() {
		this.row = null;
		this.failures = 0;
	}
	async prune() {}
	async get() { return this.row; }
	async clear() { this.row = null; this.failures = 0; }
	async recordFailure(_key, now, options) {
		this.failures += 1;
		const lockedUntil =
			this.failures >= options.maxFailures ? now + options.lockMs : 0;
		this.row = {
			failure_count: this.failures,
			window_started_at: now,
			locked_until: lockedUntil,
		};
		return { failures: this.failures, lockedUntil };
	}
}

function authRequest() {
	return new Request("https://example.test/admin/api/v1/auth/login", {
		method: "POST",
		headers: {
			"CF-Connecting-IP": "203.0.113.10",
			"User-Agent": "Phase16-Auth",
			"CF-Ray": "ray-16",
			"CF-IPCountry": "NL",
		},
	});
}

function makeAuth(history) {
	const users = new FakeUsers();
	const sessions = new FakeSessions();
	const attempts = new FakeAttempts();
	return {
		users,
		sessions,
		attempts,
		service: new WebAuthService(
			{},
			users,
			sessions,
			attempts,
			new FakeHasher(),
			history,
		),
	};
}

test("successful login records success with safe session reference", async () => {
	const records = [];
	const history = { async record(_request, data) { records.push({ ...data }); } };
	const { service, sessions } = makeAuth(history);
	const result = await service.login(authRequest(), "admin", "admin");
	assert.equal(result.ok, true);
	assert.equal(records.length, 1);
	assert.equal(records[0].result, "success");
	assert.equal(records[0].reason, "authenticated");
	assert.equal(records[0].userId, 1);
	assert.match(records[0].sessionRef, /^[A-Za-z0-9_-]{16}$/);
	assert.equal(sessions.rows.length, 1);
	assert.equal(Object.hasOwn(result, "sessionRef"), false);
});

test("invalid credentials record failure without password or session material", async () => {
	const records = [];
	const history = { async record(_request, data) { records.push({ ...data }); } };
	const { service } = makeAuth(history);
	const result = await service.login(authRequest(), "admin", "wrong");
	assert.equal(result.status, 401);
	assert.equal(records.length, 1);
	assert.equal(records[0].result, "failure");
	assert.equal(records[0].reason, "invalid_credentials");
	assert.equal(records[0].username, "admin");
	assert.equal(Object.hasOwn(records[0], "password"), false);
	assert.equal(records[0].sessionRef ?? null, null);
});

test("fifth failed login is recorded as locked with lockout reason", async () => {
	const records = [];
	const history = { async record(_request, data) { records.push({ ...data }); } };
	const { service } = makeAuth(history);
	let result;
	for (let index = 0; index < 5; index += 1) {
		result = await service.login(authRequest(), "admin", "wrong");
	}
	assert.equal(result.status, 429);
	assert.equal(records.at(-1).result, "locked");
	assert.equal(records.at(-1).reason, "invalid_credentials_lockout");
});

test("attempt during active lockout records locked rate-limited result", async () => {
	const records = [];
	const history = { async record(_request, data) { records.push({ ...data }); } };
	const { service } = makeAuth(history);
	for (let index = 0; index < 5; index += 1) {
		await service.login(authRequest(), "admin", "wrong");
	}
	const before = records.length;
	const locked = await service.login(authRequest(), "admin", "admin");
	assert.equal(locked.status, 429);
	assert.equal(records.length, before + 1);
	assert.equal(records.at(-1).result, "locked");
	assert.equal(records.at(-1).reason, "rate_limited");
});

test("login-history write failure fails open and never replaces successful auth", async () => {
	const history = {
		async record() {
			throw new Error("history unavailable");
		},
	};
	const { service } = makeAuth(history);
	const originalWarn = console.warn;
	const warnings = [];
	console.warn = (value) => warnings.push(value);
	try {
		const result = await service.login(authRequest(), "admin", "admin");
		assert.equal(result.ok, true);
		assert.equal(warnings.length, 1);
		assert.equal(warnings[0].event, "web_auth.login_history_write_failed");
		assert.equal(JSON.stringify(warnings[0]).includes("admin"), false);
	} finally {
		console.warn = originalWarn;
	}
});

test("legacy WebAuthService construction without history remains backwards compatible", async () => {
	const users = new FakeUsers();
	const sessions = new FakeSessions();
	const attempts = new FakeAttempts();
	const service = new WebAuthService(
		{},
		users,
		sessions,
		attempts,
		new FakeHasher(),
	);
	const result = await service.login(authRequest(), "admin", "admin");
	assert.equal(result.ok, true);
});

test("login history repository selects only security metadata and never auth secrets", async () => {
	const source = await readFile(
		new URL("../src/repositories/web-login-history.repository.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /web_admin_login_history/);
	assert.match(source, /session_ref/);
	assert.doesNotMatch(source, /password_hash|csrf_hash|token_hash|cookie/i);
});

test("schema 13 creates persistent login history with bounded result values and indexes", async () => {
	const [database, app] = await Promise.all([
		readFile(new URL("../src/database/database.js", import.meta.url), "utf8"),
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
	]);
	assert.match(app, /schemaVersion:\s*13/);
	assert.match(database, /CREATE TABLE IF NOT EXISTS web_admin_login_history/);
	assert.match(database, /CHECK\(result IN \('success', 'failure', 'locked'\)\)/);
	assert.match(database, /ip_address TEXT NOT NULL/);
	assert.match(database, /cf_ray TEXT NOT NULL DEFAULT ''/);
	assert.match(database, /session_ref TEXT/);
	assert.match(database, /idx_web_admin_login_history_created_at/);
	assert.match(database, /idx_web_admin_login_history_result/);
});

test("database diagnostics include persistent Web Admin login history", async () => {
	const source = await readFile(
		new URL("../src/system/database-status.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /"web_admin_login_history"/);
});

test("composition root exposes one shared login-history repository and service to WebAuthService", async () => {
	const source = await readFile(
		new URL("../src/app/container.js", import.meta.url),
		"utf8",
	);
	assert.equal(
		(source.match(/new WebLoginHistoryRepository\(runtimeEnv\)/g) || []).length,
		1,
	);
	assert.equal(
		(source.match(/new LoginHistoryService\(webLoginHistoryRepository\)/g) || []).length,
		1,
	);
	assert.match(source, /webAuthAttempts, undefined, loginHistory/);
	assert.match(source, /webLoginHistoryRepository,/);
	assert.match(source, /loginHistory,/);
});

test("auth source records success failure and locked events without credential fields", async () => {
	const source = await readFile(
		new URL("../src/services/web-auth.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /result: "success"/);
	assert.match(source, /result: lockedNow \? "locked" : "failure"/);
	assert.match(source, /result: "locked"/);
	assert.match(source, /sessionRef: session\.sessionRef/);
	assert.doesNotMatch(source, /loginHistory\.record\([^)]*password/s);
});

test("Phase 16.1 keeps application version 0.13.0 while schema advances to 13", async () => {
	const source = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(source, /version:\s*"0\.13\.0"/);
	assert.match(source, /schemaVersion:\s*13/);
});
