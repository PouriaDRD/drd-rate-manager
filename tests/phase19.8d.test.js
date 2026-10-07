import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WebAuthService } from "../src/services/web-auth.service.js";
import { telegram_coreMethods } from "../src/controllers/telegram/telegram-core.methods.js";
import { MarketService } from "../src/services/market.service.js";
import { ConfigurationManagementService } from "../src/services/configuration-management.service.js";
import { AuditRepository } from "../src/repositories/audit.repository.js";
import { AutomationManagementService } from "../src/services/automation-management.service.js";

function telegramMessage(text = "/menu") {
	return {
		text,
		chat: { id: 100 },
		from: { id: 200, username: "owner" },
	};
}

function telegramMessageHarness({ input = null } = {}) {
	const calls = {
		clears: 0,
		addAdminInput: 0,
		menu: 0,
		sync: 0,
	};

	const context = {
		s: {
			telegram: {
				syncInterface() {
					calls.sync += 1;
				},
				async sendMessage() {},
			},
			admins: {
				async resolve() {
					return { role: "owner", enabled: true };
				},
				async touchProfile() {},
			},
			adminInput: {
				async get() {
					return input;
				},
				async clear() {
					calls.clears += 1;
				},
			},
			settings: {
				async get() {
					return "1";
				},
			},
		},
		async _enforceRequiredMembership() {
			return true;
		},
		async _handleAddAdminInput() {
			calls.addAdminInput += 1;
		},
		async _sendMenu() {
			calls.menu += 1;
		},
		async _sendStart() {},
		async _sendHelp() {},
		_disabledText() {
			return "disabled";
		},
		_tg() {
			return "translated";
		},
	};

	return { context, calls };
}

test("Phase 19.8D supported command cancels pending add-admin input before routing", async () => {
	const { context, calls } = telegramMessageHarness({
		input: { action: "add_admin" },
	});

	await telegram_coreMethods._message.call(context, telegramMessage("/menu"));

	assert.equal(calls.clears, 1);
	assert.equal(calls.addAdminInput, 0);
	assert.equal(calls.menu, 1);
	assert.equal(calls.sync, 1);
});

test("Phase 19.8D unknown slash command preserves pending add-admin input", async () => {
	const { context, calls } = telegramMessageHarness({
		input: { action: "add_admin" },
	});

	await telegram_coreMethods._message.call(context, telegramMessage("/does-not-exist"));

	assert.equal(calls.clears, 0);
	assert.equal(calls.addAdminInput, 0);
	assert.equal(calls.menu, 0);
});

test("Phase 19.8D admins home callback is a real cancel path for pending add-admin input", async () => {
	const calls = { clears: 0, admins: 0, answers: 0 };
	const context = {
		s: {
			telegram: {
				async answerCallback() {
					calls.answers += 1;
				},
			},
			admins: {
				async resolve() {
					return { role: "owner", userId: "200" };
				},
			},
			adminInput: {
				async clear() {
					calls.clears += 1;
				},
			},
			settings: {
				async get() {
					return "1";
				},
			},
		},
		async _enforceRequiredMembership() {
			return true;
		},
		async _showAdmins() {
			calls.admins += 1;
		},
	};

	await telegram_coreMethods._callback.call(context, {
		id: "callback-1",
		data: "admins:home",
		from: { id: 200 },
		message: { chat: { id: 100 }, message_id: 10 },
	});

	assert.equal(calls.answers, 1);
	assert.equal(calls.clears, 1);
	assert.equal(calls.admins, 1);
});

function stalePayload(price = 250_000) {
	return {
		success: true,
		partial: false,
		errors: [],
		createdAt: Date.now() - 60_000,
		usdt: {
			price,
			source: "gold-consensus",
			fallbackLevel: null,
			strategy: "consensus",
			contributors: ["wallex"],
			rejected: [],
			sampleCount: 1,
		},
		crypto: [],
		metals: {
			gram18: 25_000_000,
			mazaneh: 108_000_000,
			gold: 2_600,
			silver: 31,
			gram18Source: "gold-consensus",
			gram18Contributors: ["wallgold"],
			gram18Rejected: [],
		},
	};
}

function marketHarness({
	cacheRecord = null,
	lockAcquire = async () => "lock-token",
	cacheWrite = async () => ({
		fetchedAt: Date.now(),
		expiresAt: Date.now() + 30_000,
	}),
} = {}) {
	const calls = {
		lockAcquire: 0,
		lockRelease: 0,
		usdt: 0,
		gold: 0,
		coinGecko: 0,
		cacheWrite: 0,
	};

	const settings = {
		async get(_key, fallback) {
			return fallback;
		},
	};
	const cache = {
		async read() {
			return cacheRecord;
		},
		async write(...args) {
			calls.cacheWrite += 1;
			return cacheWrite(...args);
		},
	};
	const locks = {
		async acquire(...args) {
			calls.lockAcquire += 1;
			return lockAcquire(...args);
		},
		async release() {
			calls.lockRelease += 1;
		},
	};
	const assets = {
		async enabled() {
			return [];
		},
	};
	const statuses = {
		async save() {},
		async all() {
			return [];
		},
	};
	const sources = {
		async resolveUsdt() {
			calls.usdt += 1;
			return {
				success: true,
				price: 270_000,
				sourceLabel: "usdt-consensus",
				contributors: ["wallex", "tabdeal"],
				rejected: [],
				sampleCount: 2,
			};
		},
		async resolveGold() {
			calls.gold += 1;
			return {
				success: true,
				price: 26_000_000,
				sourceLabel: "gold-consensus",
				contributors: ["wallgold", "milli"],
				rejected: [],
			};
		},
		async checkAllUsdt() {
			throw new Error("unexpected full source check");
		},
	};
	const coinGecko = {
		async fetchMarketBundle() {
			calls.coinGecko += 1;
			return {
				success: true,
				status: 200,
				latency: 5,
				crypto: [],
				gold: 2600,
				silver: 31,
			};
		},
	};

	const market = new MarketService(
		{},
		{ timezone: "Asia/Tehran" },
		settings,
		cache,
		locks,
		assets,
		statuses,
		sources,
		coinGecko,
		null,
	);

	return { market, calls };
}

test("Phase 19.8D lock-storage failure serves an expired cached market snapshot instead of throwing", async () => {
	const cached = {
		payload: stalePayload(251_000),
		fetchedAt: Date.now() - 60_000,
		expiresAt: Date.now() - 30_000,
		lastError: null,
	};
	const { market, calls } = marketHarness({
		cacheRecord: cached,
		lockAcquire: async () => {
			throw new Error("D1 lock write failed");
		},
	});

	const snapshot = await market.getSnapshot();

	assert.equal(snapshot.usdt.price, 251_000);
	assert.equal(snapshot.cache.fromCache, true);
	assert.equal(snapshot.cache.staleFallback, true);
	assert.equal(snapshot.cache.lastError, "refresh_lock_unavailable");
	assert.equal(calls.usdt, 0);
	assert.equal(calls.gold, 0);
	assert.equal(calls.coinGecko, 0);
	assert.equal(calls.cacheWrite, 0);
});

test("Phase 19.8D lock-storage failure without any cached market snapshot fails closed", async () => {
	const { market, calls } = marketHarness({
		cacheRecord: null,
		lockAcquire: async () => {
			throw new Error("D1 lock write failed");
		},
	});

	await assert.rejects(() => market.getSnapshot(), /D1 lock write failed/);
	assert.equal(calls.usdt, 0);
	assert.equal(calls.gold, 0);
	assert.equal(calls.coinGecko, 0);
});

test("Phase 19.8D unavailable refresh lease returns stale cache without upstream work", async () => {
	const cached = {
		payload: stalePayload(252_000),
		fetchedAt: Date.now() - 60_000,
		expiresAt: Date.now() - 10_000,
		lastError: null,
	};
	const { market, calls } = marketHarness({
		cacheRecord: cached,
		lockAcquire: async () => null,
	});

	const snapshot = await market.getSnapshot();

	assert.equal(snapshot.usdt.price, 252_000);
	assert.equal(snapshot.cache.fromCache, true);
	assert.equal(snapshot.cache.staleFallback, true);
	assert.equal(snapshot.cache.lastError, "refresh_in_progress");
	assert.equal(calls.usdt, 0);
	assert.equal(calls.coinGecko, 0);
});

test("Phase 19.8D fresh cache bypasses both refresh locking and upstream providers", async () => {
	const now = Date.now();
	const cached = {
		payload: stalePayload(253_000),
		fetchedAt: now - 1_000,
		expiresAt: now + 20_000,
		lastError: null,
	};
	const { market, calls } = marketHarness({ cacheRecord: cached });

	const snapshot = await market.getSnapshot();

	assert.equal(snapshot.usdt.price, 253_000);
	assert.equal(snapshot.cache.fromCache, true);
	assert.equal(snapshot.cache.staleFallback, false);
	assert.equal(calls.lockAcquire, 0);
	assert.equal(calls.usdt, 0);
	assert.equal(calls.gold, 0);
	assert.equal(calls.coinGecko, 0);
});

test("Phase 19.8D cache-write failure after a live refresh falls back to the previous snapshot", async () => {
	const cached = {
		payload: stalePayload(254_000),
		fetchedAt: Date.now() - 60_000,
		expiresAt: Date.now() - 10_000,
		lastError: null,
	};
	const { market, calls } = marketHarness({
		cacheRecord: cached,
		cacheWrite: async () => {
			throw new Error("cache write unavailable");
		},
	});

	const snapshot = await market.getSnapshot();

	assert.equal(snapshot.usdt.price, 254_000);
	assert.equal(snapshot.cache.fromCache, true);
	assert.equal(snapshot.cache.staleFallback, true);
	assert.match(snapshot.cache.lastError, /cache write unavailable/);
	assert.equal(calls.usdt, 1);
	assert.equal(calls.gold, 1);
	assert.equal(calls.coinGecko, 1);
	assert.equal(calls.lockRelease, 1);
});

function authHarness(sessionOverrides = {}, { csrfHash = "ignored", userOverrides = {} } = {}) {
	const calls = { removed: [], touched: [] };
	const now = Date.now();
	const session = {
		user_id: 1,
		credential_version: 7,
		expires_at: now + 60_000,
		last_seen_at: now,
		csrf_hash: csrfHash,
		...sessionOverrides,
	};
	const user = {
		id: 1,
		username: "owner",
		admin_path: "private-admin",
		credential_version: 7,
		must_complete_bootstrap: 0,
		last_login_at: 0,
		...userOverrides,
	};

	const service = new WebAuthService(
		{},
		{
			async getPrimary() {
				return user;
			},
		},
		{
			async get() {
				return session;
			},
			async remove(hash) {
				calls.removed.push(hash);
			},
			async touch(hash, value) {
				calls.touched.push([hash, value]);
			},
		},
		{},
		{
			async verify() {
				return true;
			},
		},
	);

	return { service, calls, now };
}

function authRequest({ csrf = "" } = {}) {
	const headers = new Headers({
		Cookie: "__Host-drd_admin_session=session-token",
	});
	if (csrf) headers.set("X-CSRF-Token", csrf);
	return new Request("https://example.test/private-admin/api/v1/test", {
		method: "PATCH",
		headers,
	});
}

async function base64UrlSha256(value) {
	const bytes = new TextEncoder().encode(value);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	let binary = "";
	for (const byte of digest) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

test("Phase 19.8D expired Web Admin sessions are removed and rejected", async () => {
	const { service, calls, now } = authHarness({
		expires_at: nowPlaceholder(),
	});
	// Use a definitely expired timestamp independent of constructor timing.
	service.sessions.get = async () => ({
		user_id: 1,
		credential_version: 7,
		expires_at: Date.now() - 1,
		last_seen_at: Date.now(),
		csrf_hash: "",
	});

	const authenticated = await service.authenticate(authRequest());
	assert.equal(authenticated, null);
	assert.equal(calls.removed.length, 1);
});

function nowPlaceholder() {
	return 1;
}

test("Phase 19.8D credential-version mismatch invalidates the persisted session", async () => {
	const { service, calls } = authHarness({}, {
		userOverrides: { credential_version: 8 },
	});

	const authenticated = await service.authenticate(authRequest());

	assert.equal(authenticated, null);
	assert.equal(calls.removed.length, 1);
});

test("Phase 19.8D invalid CSRF rejects a valid session without deleting it", async () => {
	const expectedHash = await base64UrlSha256("correct-csrf");
	const { service, calls } = authHarness({}, { csrfHash: expectedHash });

	const authenticated = await service.authenticate(
		authRequest({ csrf: "wrong-csrf" }),
		{ requireCsrf: true },
	);

	assert.equal(authenticated, null);
	assert.equal(calls.removed.length, 0);
});

test("Phase 19.8D valid CSRF authenticates the same live session", async () => {
	const expectedHash = await base64UrlSha256("correct-csrf");
	const { service, calls } = authHarness({}, { csrfHash: expectedHash });

	const authenticated = await service.authenticate(
		authRequest({ csrf: "correct-csrf" }),
		{ requireCsrf: true },
	);

	assert.ok(authenticated);
	assert.equal(authenticated.user.id, 1);
	assert.equal(calls.removed.length, 0);
});

function configurationHarness({ settingsFailure = null, secureFailure = null } = {}) {
	const audits = [];
	const settingsService = {
		get() {
			return "value";
		},
		getSource() {
			return "d1";
		},
		async setMany() {
			if (settingsFailure) throw settingsFailure;
		},
	};
	const secureSettingsService = {
		status() {
			return {
				masterKeyConfigured: true,
				secrets: {
					"telegram.bot_token": {
						configured: true,
						source: "encrypted_d1",
					},
				},
			};
		},
		async set() {
			if (secureFailure) throw secureFailure;
		},
	};
	const service = new ConfigurationManagementService({
		settingsService,
		secureSettingsService,
		audit: {
			async add(...args) {
				audits.push(args);
			},
		},
		webAuth: {
			async confirmPassword() {
				return true;
			},
		},
		rawEnv: {
			APP_MASTER_KEY: "configured",
		},
	});
	return { service, audits };
}

test("Phase 19.8D failed runtime persistence never emits a false audit success", async () => {
	const { service, audits } = configurationHarness({
		settingsFailure: new Error("runtime storage unavailable"),
	});

	await assert.rejects(
		() =>
			service.updateRuntime(
				{ "general.timezone": "Asia/Tehran" },
				{ id: "1" },
			),
		/runtime storage unavailable/,
	);
	assert.equal(audits.length, 0);
});

test("Phase 19.8D failed secure persistence never emits a false audit success", async () => {
	const { service, audits } = configurationHarness({
		secureFailure: new Error("secure storage unavailable"),
	});

	await assert.rejects(
		() =>
			service.replaceSecret(
				{
					key: "telegram.bot_token",
					value: "replacement-secret",
					currentPassword: "correct-password",
					authenticated: { user: { id: 1 } },
				},
				{ id: "1" },
			),
		/secure storage unavailable/,
	);
	assert.equal(audits.length, 0);
});

test("Phase 19.8D audit storage failure is fail-open and never logs mutation payload data", async () => {
	const originalWarn = console.warn;
	const warnings = [];
	console.warn = (...args) => warnings.push(args);
	try {
		const repository = new AuditRepository({
			DB: {
				prepare() {
					return {
						bind() {
							return this;
						},
						async run() {
							throw new Error("audit database unavailable");
						},
					};
				},
			},
		});

		await repository.add("1", "security.test", {
			secret: "must-not-appear-in-warning",
		});
	} finally {
		console.warn = originalWarn;
	}

	assert.equal(warnings.length, 1);
	assert.match(String(warnings[0][0]), /audit\.write_failed/);
	assert.doesNotMatch(JSON.stringify(warnings), /must-not-appear-in-warning/);
});

function automationHarness({ publishError = null, historyError = null } = {}) {
	const calls = { acquire: 0, release: 0, history: 0, publish: 0 };
	const service = new AutomationManagementService(
		{ timezone: "Asia/Tehran" },
		{},
		{},
		{
			async getSnapshot() {
				return {
					partial: false,
					createdAt: Date.now(),
				};
			},
		},
		{
			async publish() {
				calls.publish += 1;
				if (publishError) throw publishError;
				return { message_id: 77 };
			},
		},
		{},
		{
			async acquire() {
				calls.acquire += 1;
				return "manual-lock";
			},
			async release() {
				calls.release += 1;
			},
		},
		{
			async add() {
				calls.history += 1;
				if (historyError) throw historyError;
			},
			async list() {
				return [];
			},
		},
	);
	return { service, calls };
}

test("Phase 19.8D automation history failure cannot turn a successful manual publish into failure", async () => {
	const originalWarn = console.warn;
	console.warn = () => {};
	try {
		const { service, calls } = automationHarness({
			historyError: new Error("history unavailable"),
		});

		const result = await service.forceRun({
			actor: { type: "web", id: "1" },
		});

		assert.equal(result.messageId, 77);
		assert.equal(calls.publish, 1);
		assert.equal(calls.history, 1);
		assert.equal(calls.release, 1);
	} finally {
		console.warn = originalWarn;
	}
});

test("Phase 19.8D publish failure remains the primary error even if history persistence also fails", async () => {
	const originalWarn = console.warn;
	console.warn = () => {};
	try {
		const { service, calls } = automationHarness({
			publishError: new Error("telegram publish failed"),
			historyError: new Error("history unavailable"),
		});

		await assert.rejects(
			() => service.forceRun({ actor: { type: "web", id: "1" } }),
			/telegram publish failed/,
		);
		assert.equal(calls.publish, 1);
		assert.equal(calls.history, 1);
		assert.equal(calls.release, 1);
	} finally {
		console.warn = originalWarn;
	}
});

test("Phase 19.8D remains a hardening-only slice with stable app and schema identity", async () => {
	const source = await readFile(
		new URL("../src/config/app.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /version:\s*"0\.2\.1"/);
	assert.match(source, /schemaVersion:\s*13/);
});

test("Phase 19.8 aggregate command includes final D hardening coverage", async () => {
	const pkg = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	);
	assert.match(pkg.scripts["test:phase19.8"], /phase19\.8d\.test\.js/);
	assert.match(pkg.scripts["test:hardening"], /test:phase19\.8/);
	assert.match(pkg.scripts["test:hardening"], /test:browser/);
});
