import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ApiTokenRepository } from "../src/repositories/api-token.repository.js";
import {
	API_TOKEN_PREFIXES,
	API_TOKEN_TYPES,
	ApiTokenService,
	hashApiToken,
} from "../src/services/api-token.service.js";

function memoryRepository() {
	const rows = [];
	let id = 0;
	return {
		rows,
		async create(record) {
			const row = {
				id: ++id,
				name: record.name,
				type: record.type,
				prefix: record.prefix,
				enabled: true,
				expiresAt: record.expiresAt,
				lastUsedAt: 0,
				usageCount: 0,
				revokedAt: 0,
				createdByType: record.createdByType,
				createdById: record.createdById,
				createdAt: record.createdAt,
				updatedAt: record.createdAt,
				tokenHash: record.tokenHash,
			};
			rows.push(row);
			return publicRow(row);
		},
		async findByHash(hash) {
			return rows.find((row) => row.tokenHash === hash) || null;
		},
		async list(type = null) {
			return rows
				.filter((row) => !type || row.type === type)
				.map(publicRow);
		},
		async setEnabled(targetId, enabled, now) {
			const row = rows.find((item) => item.id === Number(targetId));
			if (!row || row.revokedAt) return row ? publicRow(row) : null;
			row.enabled = enabled;
			row.updatedAt = now;
			return publicRow(row);
		},
		async revoke(targetId, now) {
			const row = rows.find((item) => item.id === Number(targetId));
			if (!row) return null;
			row.enabled = false;
			row.revokedAt ||= now;
			row.updatedAt = now;
			return publicRow(row);
		},
		async touchUsage(targetId, now) {
			const row = rows.find((item) => item.id === Number(targetId));
			row.lastUsedAt = now;
			row.usageCount += 1;
			row.updatedAt = now;
		},
	};
}

function publicRow(row) {
	const { tokenHash: _tokenHash, ...safe } = row;
	return { ...safe };
}

function deterministicCrypto() {
	let seed = 1;
	return {
		getRandomValues(buffer) {
			for (let index = 0; index < buffer.length; index += 1) {
				buffer[index] = (seed + index) % 256;
			}
			seed += buffer.length;
			return buffer;
		},
		subtle: globalThis.crypto.subtle,
	};
}

function request(token = null) {
	return new Request("https://example.test/api/v1/market", {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
}

test("token namespaces are cryptographically separate by visible prefix and stored scope", async () => {
	const repository = memoryRepository();
	const service = new ApiTokenService(repository, {
		cryptoRef: deterministicCrypto(),
		now: () => 1000,
	});
	const market = await service.issue({ name: "Market app", type: API_TOKEN_TYPES.MARKET });
	const core = await service.issue({ name: "Core app", type: API_TOKEN_TYPES.CORE });

	assert.match(market.token, /^drd_mkt_[A-Za-z0-9_-]{40,}$/);
	assert.match(core.token, /^drd_core_[A-Za-z0-9_-]{40,}$/);
	assert.equal(market.record.type, "market");
	assert.equal(core.record.type, "core");
	assert.notEqual(market.token, core.token);
	assert.equal(API_TOKEN_PREFIXES.market, "drd_mkt_");
	assert.equal(API_TOKEN_PREFIXES.core, "drd_core_");
});

test("raw token is returned once but repository receives only its SHA-256 hash", async () => {
	const repository = memoryRepository();
	const service = new ApiTokenService(repository, {
		cryptoRef: deterministicCrypto(),
		now: () => 2000,
	});
	const issued = await service.issue({ name: "Private integration", type: "core" });

	assert.equal(repository.rows.length, 1);
	assert.equal(repository.rows[0].tokenHash, await hashApiToken(issued.token));
	assert.notEqual(repository.rows[0].tokenHash, issued.token);
	assert.equal(JSON.stringify(issued.record).includes(issued.token), false);
	assert.equal(Object.hasOwn(issued.record, "tokenHash"), false);
});

test("market token authenticates only market scope", async () => {
	const repository = memoryRepository();
	const service = new ApiTokenService(repository, {
		cryptoRef: deterministicCrypto(),
		now: () => 3000,
	});
	const issued = await service.issue({ name: "Market", type: "market" });

	const allowed = await service.authenticate(request(issued.token), "market");
	const blocked = await service.authenticate(request(issued.token), "core");

	assert.equal(allowed.ok, true);
	assert.equal(allowed.status, 200);
	assert.equal(blocked.ok, false);
	assert.equal(blocked.status, 403);
	assert.equal(blocked.reason, "wrong_scope");
	assert.equal(repository.rows[0].usageCount, 1);
});

test("core token authenticates only core scope", async () => {
	const repository = memoryRepository();
	const service = new ApiTokenService(repository, {
		cryptoRef: deterministicCrypto(),
		now: () => 4000,
	});
	const issued = await service.issue({ name: "Core", type: "core" });

	assert.equal((await service.authenticate(request(issued.token), "core")).ok, true);
	const blocked = await service.authenticate(request(issued.token), "market");
	assert.equal(blocked.status, 403);
	assert.equal(blocked.reason, "wrong_scope");
});

test("missing malformed and unknown tokens fail with 401", async () => {
	const service = new ApiTokenService(memoryRepository(), {
		cryptoRef: deterministicCrypto(),
		now: () => 5000,
	});
	assert.equal((await service.authenticate(request(), "core")).status, 401);
	assert.equal(
		(
			await service.authenticate(
				request("something_else"),
				"core",
			)
		).reason,
		"invalid_token",
	);
	assert.equal(
		(
			await service.authenticate(
				request("drd_core_unknown"),
				"core",
			)
		).status,
		401,
	);
});

test("disabled revoked and expired tokens are rejected and do not increment usage", async () => {
	const repository = memoryRepository();
	let now = 10_000;
	const service = new ApiTokenService(repository, {
		cryptoRef: deterministicCrypto(),
		now: () => now,
	});

	const disabled = await service.issue({ name: "Disabled", type: "core" });
	await service.setEnabled(disabled.record.id, false);
	assert.equal(
		(await service.authenticate(request(disabled.token), "core")).reason,
		"token_disabled",
	);

	const revoked = await service.issue({ name: "Revoked", type: "core" });
	await service.revoke(revoked.record.id);
	assert.equal(
		(await service.authenticate(request(revoked.token), "core")).reason,
		"token_revoked",
	);

	const expiring = await service.issue({
		name: "Expiring",
		type: "core",
		expiresAt: now + 100,
	});
	now += 101;
	assert.equal(
		(await service.authenticate(request(expiring.token), "core")).reason,
		"token_expired",
	);

	assert.equal(repository.rows.reduce((sum, row) => sum + row.usageCount, 0), 0);
});

test("token creation rejects invalid names types and past expiration", async () => {
	const service = new ApiTokenService(memoryRepository(), {
		cryptoRef: deterministicCrypto(),
		now: () => 1000,
	});
	await assert.rejects(() => service.issue({ name: "", type: "core" }), /name/i);
	await assert.rejects(() => service.issue({ name: "x", type: "admin" }), /type/i);
	await assert.rejects(
		() => service.issue({ name: "x", type: "core", expiresAt: 999 }),
		/expiration/i,
	);
});

test("repository public reads never select token_hash", async () => {
	const source = await readFile(
		new URL("../src/repositories/api-token.repository.js", import.meta.url),
		"utf8",
	);
	const listStart = source.indexOf("async list");
	const setEnabledStart = source.indexOf("async setEnabled");
	const publicListSource = source.slice(listStart, setEnabledStart);
	assert.doesNotMatch(publicListSource, /token_hash/);
	assert.match(source, /findByHash\(tokenHash\)/);
});

test("schema 12 creates api_tokens with scoped type hash and lifecycle metadata", async () => {
	const [app, database, status] = await Promise.all([
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
		readFile(new URL("../src/database/database.js", import.meta.url), "utf8"),
		readFile(new URL("../src/system/database-status.js", import.meta.url), "utf8"),
	]);
	assert.match(app, /schemaVersion:\s*13/);
	assert.match(database, /CREATE TABLE IF NOT EXISTS api_tokens/);
	assert.match(database, /token_type TEXT NOT NULL CHECK\(token_type IN \('market', 'core'\)\)/);
	assert.match(database, /token_hash TEXT NOT NULL UNIQUE/);
	assert.match(database, /usage_count INTEGER NOT NULL DEFAULT 0/);
	assert.match(database, /revoked_at INTEGER NOT NULL DEFAULT 0/);
	assert.match(status, /"api_tokens"/);
});

test("composition root wires one shared API token repository and service", async () => {
	const source = await readFile(new URL("../src/app/container.js", import.meta.url), "utf8");
	assert.equal((source.match(/new ApiTokenRepository\(runtimeEnv\)/g) || []).length, 1);
	assert.equal((source.match(/new ApiTokenService\(apiTokenRepository\)/g) || []).length, 1);
	assert.match(source, /apiTokenRepository,/);
	assert.match(source, /apiTokens,/);
});

test("Phase 15.1 deliberately does not enforce tokens on public API routes yet", async () => {
	const source = await readFile(
		new URL("../src/controllers/api.controller.js", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /apiTokens\.authenticate/);
});

test("application version remains 0.2.1 while storage schema advances to 12", async () => {
	const source = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(source, /version:\s*"0\.2\.1"/);
	assert.match(source, /schemaVersion:\s*13/);
});
