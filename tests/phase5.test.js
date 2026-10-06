import assert from "node:assert/strict";
import test from "node:test";

import { PasswordHasher, PASSWORD_HASH_CONFIG } from "../src/auth/password-hasher.js";
import { WEB_AUTH, validateAdminPath, validatePassword, validateUsername } from "../src/auth/web-auth-utils.js";
import { WebAdminAuthController } from "../src/controllers/web-admin-auth.controller.js";
import { WebAuthService } from "../src/services/web-auth.service.js";

const TEST_MASTER_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

class FakeHasher {
	async hash(password) {
		return {
			passwordHash: `hash:${password}`,
			passwordSalt: "salt",
			passwordAlgorithm: "HMAC-SHA256-PEPPER+PBKDF2-HMAC-SHA256",
			passwordIterations: 100_000,
		};
	}
	async verify(password, record) {
		return record?.password_hash === `hash:${password}`;
	}
}

class FakeUsers {
	constructor() { this.user = null; }
	async getPrimary() { return this.user ? { ...this.user } : null; }
	async getByUsername(username) { return this.user?.username === username ? { ...this.user } : null; }
	async createBootstrap(record) {
		if (!this.user) {
			this.user = {
				id: 1,
				username: record.username,
				password_hash: record.passwordHash,
				password_salt: record.passwordSalt,
				password_algorithm: record.passwordAlgorithm,
				password_iterations: record.passwordIterations,
				admin_path: record.adminPath,
				must_complete_bootstrap: 1,
				credential_version: 1,
				last_login_at: 0,
			};
		}
		return { ...this.user };
	}
	async touchLogin(_id, now) { this.user.last_login_at = now; }
	async completeBootstrap(_id, record) {
		this.user = {
			...this.user,
			username: record.username,
			password_hash: record.passwordHash,
			password_salt: record.passwordSalt,
			password_algorithm: record.passwordAlgorithm,
			password_iterations: record.passwordIterations,
			admin_path: record.adminPath,
			must_complete_bootstrap: 0,
			credential_version: this.user.credential_version + 1,
		};
		return { ...this.user };
	}
	async updateCredentials(_id, record) {
		this.user = {
			...this.user,
			username: record.username,
			password_hash: record.passwordHash,
			password_salt: record.passwordSalt,
			password_algorithm: record.passwordAlgorithm,
			password_iterations: record.passwordIterations,
			admin_path: record.adminPath,
			credential_version: this.user.credential_version + 1,
		};
		return { ...this.user };
	}
}

class FakeSessions {
	constructor() { this.rows = new Map(); this.removedAll = 0; }
	async create(row) { this.rows.set(row.tokenHash, { token_hash: row.tokenHash, user_id: row.userId, csrf_hash: row.csrfHash, credential_version: row.credentialVersion, created_at: row.createdAt, last_seen_at: row.lastSeenAt, expires_at: row.expiresAt, ip_hash: row.ipHash, user_agent: row.userAgent }); }
	async get(hash) { return this.rows.get(hash) || null; }
	async touch(hash, now) { const row = this.rows.get(hash); if (row) row.last_seen_at = now; }
	async rotateCsrf(hash, csrfHash) { const row = this.rows.get(hash); if (row) row.csrf_hash = csrfHash; }
	async remove(hash) { this.rows.delete(hash); }
	async removeAllForUser(userId) { for (const [key, row] of this.rows) if (Number(row.user_id) === Number(userId)) this.rows.delete(key); this.removedAll += 1; }
	async pruneExpired(now) { for (const [key, row] of this.rows) if (row.expires_at <= now) this.rows.delete(key); }
}

class FakeAttempts {
	constructor() { this.rows = new Map(); }
	async get(key) { return this.rows.get(key) || null; }
	async clear(key) { this.rows.delete(key); }
	async prune() {}
	async recordFailure(key, now, options) {
		const current = this.rows.get(key);
		let failure_count = 1;
		let window_started_at = now;
		if (current && now - current.window_started_at <= options.windowMs) {
			failure_count = current.failure_count + 1;
			window_started_at = current.window_started_at;
		}
		const locked_until = failure_count >= options.maxFailures ? now + options.lockMs : 0;
		this.rows.set(key, { attempt_key: key, failure_count, window_started_at, locked_until });
		return { failures: failure_count, lockedUntil: locked_until };
	}
}

function makeService() {
	const users = new FakeUsers();
	const sessions = new FakeSessions();
	const attempts = new FakeAttempts();
	return { users, sessions, attempts, service: new WebAuthService({}, users, sessions, attempts, new FakeHasher()) };
}

function loginRequest(cookie = "", csrf = "") {
	const headers = { "CF-Connecting-IP": "203.0.113.10", "User-Agent": "Phase5-Test" };
	if (cookie) headers.Cookie = cookie;
	if (csrf) headers["X-CSRF-Token"] = csrf;
	return new Request("https://example.test/admin/api/v1/auth/login", { method: "POST", headers });
}

function cookiePair(setCookie) { return String(setCookie).split(";")[0]; }

test("password hashing uses a secret pepper and the Cloudflare Workers PBKDF2 ceiling", async () => {
	const hasher = new PasswordHasher(TEST_MASTER_KEY);
	const record = await hasher.hash("a-strong-password-123");
	assert.equal(
		record.passwordAlgorithm,
		"HMAC-SHA256-PEPPER+PBKDF2-HMAC-SHA256",
	);
	assert.equal(record.passwordIterations, PASSWORD_HASH_CONFIG.iterations);
	assert.equal(record.passwordIterations, 100_000);
	assert.equal(await hasher.verify("a-strong-password-123", {
		password_hash: record.passwordHash,
		password_salt: record.passwordSalt,
		password_algorithm: record.passwordAlgorithm,
		password_iterations: record.passwordIterations,
	}), true);
	assert.equal(await hasher.verify("wrong-password", {
		password_hash: record.passwordHash,
		password_salt: record.passwordSalt,
		password_algorithm: record.passwordAlgorithm,
		password_iterations: record.passwordIterations,
	}), false);
});

test("bootstrap validators require non-default secure credentials and admin path", () => {
	assert.equal(validateUsername("Pouria.Admin"), "pouria.admin");
	assert.equal(validatePassword("a-secure-password"), "a-secure-password");
	assert.equal(validateAdminPath("Management-X8K2"), "management-x8k2");
	assert.throws(() => validateAdminPath("admin"), /reserved/i);
	assert.throws(() => validatePassword("short"), /12-128/);
});

test("bootstrap admin starts as admin/admin on /admin and requires completion", async () => {
	const { service } = makeService();
	const state = await service.routingState();
	assert.deepEqual(state, {
		id: 1,
		username: "admin",
		adminPath: "admin",
		mustCompleteBootstrap: true,
		lastLoginAt: 0,
	});
});

test("login creates HttpOnly Strict session and CSRF token", async () => {
	const { service, sessions } = makeService();
	await service.ensureBootstrapAdmin();
	const result = await service.login(loginRequest(), "admin", "admin");
	assert.equal(result.ok, true);
	assert.match(result.cookie, /HttpOnly/);
	assert.match(result.cookie, /Secure/);
	assert.match(result.cookie, /SameSite=Strict/);
	assert.ok(result.csrfToken.length >= 32);
	assert.equal(sessions.rows.size, 1);
});

test("five failed logins lock the same username and IP", async () => {
	const { service } = makeService();
	await service.ensureBootstrapAdmin();
	let result;
	for (let attempt = 0; attempt < WEB_AUTH.maxLoginFailures; attempt += 1) {
		result = await service.login(loginRequest(), "admin", "bad-password");
	}
	assert.equal(result.status, 429);
	const locked = await service.login(loginRequest(), "admin", "admin");
	assert.equal(locked.status, 429);
	assert.ok(locked.retryAfterSeconds > 0);
});

test("bootstrap changes username/password/admin path and invalidates every session", async () => {
	const { service, users, sessions } = makeService();
	await service.ensureBootstrapAdmin();
	const login = await service.login(loginRequest(), "admin", "admin");
	const cookie = cookiePair(login.cookie);
	const auth = await service.authenticate(loginRequest(cookie, login.csrfToken), { requireCsrf: true });
	assert.ok(auth);
	const updated = await service.completeBootstrap(auth, {
		username: "pouria",
		password: "a-new-secure-password",
		admin_path: "management-x8k2",
	});
	assert.equal(updated.username, "pouria");
	assert.equal(updated.adminPath, "management-x8k2");
	assert.equal(updated.mustCompleteBootstrap, false);
	assert.equal(users.user.credential_version, 2);
	assert.equal(sessions.rows.size, 0);
	assert.equal(sessions.removedAll, 1);
});

test("CSRF is required for mutations and session endpoint can rotate it", async () => {
	const { service } = makeService();
	await service.ensureBootstrapAdmin();
	const login = await service.login(loginRequest(), "admin", "admin");
	const cookie = cookiePair(login.cookie);
	assert.equal(await service.authenticate(loginRequest(cookie), { requireCsrf: true }), null);
	const auth = await service.authenticate(loginRequest(cookie, login.csrfToken), { requireCsrf: true });
	assert.ok(auth);
	const rotated = await service.rotateCsrf(auth);
	assert.notEqual(rotated, login.csrfToken);
	assert.equal(await service.authenticate(loginRequest(cookie, login.csrfToken), { requireCsrf: true }), null);
	assert.ok(await service.authenticate(loginRequest(cookie, rotated), { requireCsrf: true }));
});

test("controller only serves the current admin path and applies no-store security headers", async () => {
	const state = { id: 1, username: "x", adminPath: "secret-panel", mustCompleteBootstrap: false, lastLoginAt: 0 };
	const controller = new WebAdminAuthController({
		webAuth: {
			async routingState() { return state; },
			async authenticate() { return null; },
		},
	});
	assert.equal(await controller.route(new Request("https://example.test/admin"), new URL("https://example.test/admin")), null);
	const response = await controller.route(new Request("https://example.test/secret-panel"), new URL("https://example.test/secret-panel"));
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate");
	assert.equal(response.headers.get("X-Frame-Options"), "DENY");
	assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});
