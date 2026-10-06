import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	API_MANAGEMENT_POLICY,
	ApiManagementError,
	ApiManagementService,
} from "../src/services/api-management.service.js";
import { WebAdminApiManagementController } from "../src/controllers/web-admin-api-management.controller.js";

function actor(role = "owner", type = "web", id = "1") {
	return { role, type, id };
}

function token(id, overrides = {}) {
	return {
		id,
		name: `Token ${id}`,
		type: id % 2 ? "market" : "core",
		prefix: id % 2 ? `drd_mkt_${id}` : `drd_core_${id}`,
		enabled: true,
		expiresAt: 0,
		lastUsedAt: 0,
		usageCount: 0,
		revokedAt: 0,
		createdByType: "web",
		createdById: "web:1",
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

function managementHarness({
	now = 10_000,
	tokens = [token(1), token(2)],
	mode = "public",
	issueError = null,
	revokeErrorFor = null,
} = {}) {
	const rows = tokens.map((item) => ({ ...item }));
	const audit = [];
	let marketMode = mode;
	let nextId = rows.reduce((max, item) => Math.max(max, item.id), 0) + 1;

	const apiTokens = {
		async list() {
			return rows.map((item) => ({ ...item }));
		},
		async issue(input) {
			if (issueError) throw issueError;
			const row = token(nextId++, {
				name: input.name,
				type: input.type,
				prefix: `${input.type === "market" ? "drd_mkt_" : "drd_core_"}new`,
				expiresAt: input.expiresAt,
				createdByType: input.createdByType,
				createdById: input.createdById,
				createdAt: now,
				updatedAt: now,
			});
			rows.push(row);
			return { token: `${row.prefix}_RAW_SECRET`, record: { ...row } };
		},
		async setEnabled(id, enabled) {
			const row = rows.find((item) => item.id === Number(id));
			row.enabled = Boolean(enabled);
			row.updatedAt = now;
			return { ...row };
		},
		async revoke(id) {
			if (Number(id) === Number(revokeErrorFor)) throw new Error("revoke failed");
			const row = rows.find((item) => item.id === Number(id));
			if (!row) throw new Error("missing");
			row.enabled = false;
			row.revokedAt ||= now;
			row.updatedAt = now;
			return { ...row };
		},
	};

	const apiAccess = {
		async marketMode() {
			return marketMode;
		},
		async setMarketMode(value) {
			const normalized = String(value || "").toLowerCase();
			if (!["public", "private"].includes(normalized)) {
				throw new Error("Market API mode must be public or private.");
			}
			marketMode = normalized;
			return marketMode;
		},
	};

	const auditRepo = {
		async add(userId, action, data) {
			audit.push({ userId, action, data });
		},
	};

	return {
		rows,
		audit,
		apiTokens,
		apiAccess,
		service: new ApiManagementService(apiTokens, apiAccess, auditRepo, {
			now: () => now,
		}),
		get mode() {
			return marketMode;
		},
	};
}

test("API management policy is owner-only and shared across Web/Telegram control planes", () => {
	assert.equal(API_MANAGEMENT_POLICY.ownerOnly, true);
	assert.equal(API_MANAGEMENT_POLICY.rawTokenRecoverable, false);
	assert.deepEqual(API_MANAGEMENT_POLICY.tokenTypes, ["market", "core"]);
});

test("snapshot returns safe token metadata, market mode and deterministic stats", async () => {
	const harness = managementHarness({
		tokens: [
			token(1),
			token(2, { enabled: false }),
			token(3, { revokedAt: 9000, enabled: false }),
			token(4, { expiresAt: 9000 }),
		],
		mode: "private",
	});
	const snapshot = await harness.service.snapshot(actor());
	assert.equal(snapshot.marketMode, "private");
	assert.equal(snapshot.stats.total, 4);
	assert.equal(snapshot.stats.active, 1);
	assert.equal(snapshot.stats.market, 2);
	assert.equal(snapshot.stats.core, 2);
	assert.equal(snapshot.stats.revoked, 1);
	assert.equal(snapshot.capabilities.canManage, true);
	assert.equal(snapshot.capabilities.rawTokensRecoverable, false);
	assert.equal(JSON.stringify(snapshot).includes("tokenHash"), false);
	assert.equal(JSON.stringify(snapshot).includes("RAW_SECRET"), false);
});

test("non-owner actors cannot read or mutate API management", async () => {
	const harness = managementHarness();
	await assert.rejects(
		() => harness.service.snapshot(actor("admin", "telegram", "22")),
		(error) => error instanceof ApiManagementError && error.code === "owner_required",
	);
	await assert.rejects(
		() =>
			harness.service.create(
				{ name: "x", type: "market", expiresAt: 0 },
				actor("admin", "telegram", "22"),
			),
		/Only the owner/,
	);
});

test("create validates inputs, returns raw token once and audits metadata without secret", async () => {
	const harness = managementHarness({ tokens: [] });
	const created = await harness.service.create(
		{
			name: "Website",
			type: "market",
			expiresAt: 20_000,
		},
		actor(),
	);
	assert.match(created.token, /^drd_mkt_/);
	assert.equal(created.record.type, "market");
	assert.equal(created.record.expiresAt, 20_000);
	assert.equal(harness.audit.length, 1);
	assert.equal(harness.audit[0].action, "api_token.created");
	assert.equal(JSON.stringify(harness.audit).includes(created.token), false);
	assert.equal(harness.rows[0].createdById, "web:1");

	await assert.rejects(
		() => harness.service.create({ name: "", type: "market" }, actor()),
		/1 and 80/,
	);
	await assert.rejects(
		() => harness.service.create({ name: "x", type: "admin" }, actor()),
		/market or core/,
	);
	await assert.rejects(
		() =>
			harness.service.create(
				{ name: "x", type: "core", expiresAt: 9999 },
				actor(),
			),
		/future/,
	);
});

test("enable/disable is strict, idempotent and revoked tokens are immutable", async () => {
	const harness = managementHarness({
		tokens: [
			token(1),
			token(2, { revokedAt: 5000, enabled: false }),
		],
	});
	const disabled = await harness.service.setEnabled(1, false, actor());
	assert.equal(disabled.enabled, false);
	assert.equal(harness.audit.at(-1).action, "api_token.disabled");

	const before = harness.audit.length;
	const same = await harness.service.setEnabled(1, false, actor());
	assert.equal(same.enabled, false);
	assert.equal(harness.audit.length, before);

	await assert.rejects(
		() => harness.service.setEnabled(1, "false", actor()),
		/enabled must be a boolean/,
	);
	await assert.rejects(
		() => harness.service.setEnabled(2, true, actor()),
		/revoked/i,
	);
});

test("revoke is permanent and idempotent", async () => {
	const harness = managementHarness();
	const revoked = await harness.service.revoke(1, actor());
	assert.ok(revoked.revokedAt > 0);
	assert.equal(revoked.enabled, false);
	assert.equal(harness.audit.at(-1).action, "api_token.revoked");

	const before = harness.audit.length;
	const repeated = await harness.service.revoke(1, actor());
	assert.equal(repeated.revokedAt, revoked.revokedAt);
	assert.equal(harness.audit.length, before);
});

test("rotate returns one new secret, revokes old token and preserves scope/name", async () => {
	const harness = managementHarness({
		tokens: [token(1, { name: "Integration", type: "core", expiresAt: 20_000 })],
	});
	const rotated = await harness.service.rotate(1, {}, actor());
	assert.match(rotated.token, /^drd_core_/);
	assert.equal(rotated.replacedTokenId, 1);
	assert.equal(rotated.record.type, "core");
	assert.equal(rotated.record.name, "Integration");
	assert.equal(rotated.record.expiresAt, 20_000);
	assert.ok(harness.rows.find((item) => item.id === 1).revokedAt > 0);
	assert.equal(harness.audit.at(-1).action, "api_token.rotated");
	assert.equal(JSON.stringify(harness.audit).includes(rotated.token), false);
});

test("rotate fails safely and revokes the unseen replacement when old-token revoke fails", async () => {
	const harness = managementHarness({
		tokens: [token(1, { type: "market" })],
		revokeErrorFor: 1,
	});
	await assert.rejects(
		() => harness.service.rotate(1, {}, actor()),
		/revoke failed/,
	);
	const replacement = harness.rows.find((item) => item.id !== 1);
	assert.ok(replacement);
	assert.ok(replacement.revokedAt > 0);
	assert.equal(harness.audit.length, 0);
});

test("market mode mutation is owner-only and audits only real changes", async () => {
	const harness = managementHarness({ mode: "public" });
	assert.equal(await harness.service.setMarketMode("public", actor()), "public");
	assert.equal(harness.audit.length, 0);
	assert.equal(await harness.service.setMarketMode("PRIVATE", actor()), "private");
	assert.equal(harness.audit.length, 1);
	assert.equal(harness.audit[0].action, "market_api.mode_changed");
	assert.deepEqual(harness.audit[0].data.previous, "public");
	assert.deepEqual(harness.audit[0].data.mode, "private");
	await assert.rejects(
		() => harness.service.setMarketMode("broken", actor()),
		(error) => error.code === "invalid_market_mode",
	);
});

function controllerHarness({
	bootstrap = false,
	authenticated = true,
	snapshot = null,
} = {}) {
	const authCalls = [];
	const serviceCalls = [];
	const apiManagement = {
		async snapshot(actorValue) {
			serviceCalls.push({ op: "snapshot", actor: actorValue });
			return snapshot || {
				marketMode: "public",
				tokens: [],
				stats: { total: 0, active: 0, market: 0, core: 0, revoked: 0 },
				capabilities: {
					canManage: true,
					canChangeMarketMode: true,
					rawTokensRecoverable: false,
				},
			};
		},
		async create(input, actorValue) {
			serviceCalls.push({ op: "create", input, actor: actorValue });
			return { token: "drd_core_ONCE", record: token(7, { type: "core" }) };
		},
		async setEnabled(id, enabled, actorValue) {
			serviceCalls.push({ op: "setEnabled", id, enabled, actor: actorValue });
			return token(Number(id), { enabled });
		},
		async revoke(id, actorValue) {
			serviceCalls.push({ op: "revoke", id, actor: actorValue });
			return token(Number(id), { enabled: false, revokedAt: 10_000 });
		},
		async rotate(id, input, actorValue) {
			serviceCalls.push({ op: "rotate", id, input, actor: actorValue });
			return {
				token: "drd_mkt_ROTATED",
				record: token(8, { type: "market" }),
				replacedTokenId: Number(id),
			};
		},
		async setMarketMode(mode, actorValue) {
			serviceCalls.push({ op: "mode", mode, actor: actorValue });
			return mode;
		},
	};
	const services = {
		webAuth: {
			async routingState() {
				return { adminPath: "secure-panel" };
			},
			async authenticate(_request, options) {
				authCalls.push(options);
				if (!authenticated) return null;
				return {
					user: {
						id: 42,
						must_complete_bootstrap: bootstrap ? 1 : 0,
					},
				};
			},
		},
		apiManagement,
	};
	return {
		controller: new WebAdminApiManagementController(services),
		authCalls,
		serviceCalls,
	};
}

test("Web API management GET uses authenticated owner-equivalent web session without CSRF", async () => {
	const harness = controllerHarness();
	const response = await harness.controller.route(
		new Request("https://example.test/secure-panel/api/v1/api-management"),
		new URL("https://example.test/secure-panel/api/v1/api-management"),
	);
	assert.equal(response.status, 200);
	assert.deepEqual(harness.authCalls[0], { requireCsrf: false });
	assert.equal(harness.serviceCalls[0].actor.role, "owner");
	assert.equal(harness.serviceCalls[0].actor.type, "web");
	assert.match(response.headers.get("Cache-Control"), /no-store/);
});

test("Web API management mutations require CSRF and bootstrap completion", async () => {
	const harness = controllerHarness();
	const response = await harness.controller.route(
		new Request("https://example.test/secure-panel/api/v1/api-management/market-mode", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mode: "private" }),
		}),
		new URL("https://example.test/secure-panel/api/v1/api-management/market-mode"),
	);
	assert.equal(response.status, 200);
	assert.deepEqual(harness.authCalls[0], { requireCsrf: true });

	const blocked = controllerHarness({ bootstrap: true });
	const blockedResponse = await blocked.controller.route(
		new Request("https://example.test/secure-panel/api/v1/api-management/tokens", {
			method: "POST",
			body: "{}",
		}),
		new URL("https://example.test/secure-panel/api/v1/api-management/tokens"),
	);
	assert.equal(blockedResponse.status, 403);
	assert.equal(blocked.serviceCalls.length, 0);
});

test("Web token create/rotate return raw secret only in one-time mutation response", async () => {
	const harness = controllerHarness();
	const createResponse = await harness.controller.route(
		new Request("https://example.test/secure-panel/api/v1/api-management/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Core", type: "core", expires_at: "" }),
		}),
		new URL("https://example.test/secure-panel/api/v1/api-management/tokens"),
	);
	const created = await createResponse.json();
	assert.equal(createResponse.status, 201);
	assert.equal(created.data.token, "drd_core_ONCE");
	assert.equal(created.data.one_time_secret, true);

	const rotateResponse = await harness.controller.route(
		new Request("https://example.test/secure-panel/api/v1/api-management/tokens/7/rotate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		}),
		new URL("https://example.test/secure-panel/api/v1/api-management/tokens/7/rotate"),
	);
	const rotated = await rotateResponse.json();
	assert.equal(rotated.data.token, "drd_mkt_ROTATED");
	assert.equal(rotated.data.one_time_secret, true);
	assert.equal(rotated.data.replaced_token_id, 7);
});

test("Web token PATCH and DELETE route to shared management service", async () => {
	const harness = controllerHarness();
	const patchResponse = await harness.controller.route(
		new Request("https://example.test/secure-panel/api/v1/api-management/tokens/4", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: false }),
		}),
		new URL("https://example.test/secure-panel/api/v1/api-management/tokens/4"),
	);
	assert.equal(patchResponse.status, 200);
	assert.equal(harness.serviceCalls.at(-1).op, "setEnabled");

	const deleteResponse = await harness.controller.route(
		new Request("https://example.test/secure-panel/api/v1/api-management/tokens/4", {
			method: "DELETE",
		}),
		new URL("https://example.test/secure-panel/api/v1/api-management/tokens/4"),
	);
	assert.equal(deleteResponse.status, 200);
	assert.equal(harness.serviceCalls.at(-1).op, "revoke");
});

test("Web API management rejects unauthenticated requests before service access", async () => {
	const harness = controllerHarness({ authenticated: false });
	const response = await harness.controller.route(
		new Request("https://example.test/secure-panel/api/v1/api-management"),
		new URL("https://example.test/secure-panel/api/v1/api-management"),
	);
	assert.equal(response.status, 401);
	assert.equal(harness.serviceCalls.length, 0);
});

test("composition and Application wire one shared API management boundary", async () => {
	const [container, application] = await Promise.all([
		readFile(new URL("../src/app/container.js", import.meta.url), "utf8"),
		readFile(new URL("../src/app/application.js", import.meta.url), "utf8"),
	]);
	assert.equal(
		(container.match(/new ApiManagementService\(apiTokens, apiAccess, audit\)/g) || [])
			.length,
		1,
	);
	assert.match(container, /apiManagement,/);
	assert.match(application, /new WebAdminApiManagementController\(this\.services\)/);
	assert.match(application, /webAdminApiManagement\.route\(request, url\)/);
});

test("Admin UI allow-list exposes current modular feature assets plus API management", async () => {
	const source = await readFile(
		new URL("../src/controllers/web-admin-ui.controller.js", import.meta.url),
		"utf8",
	);
	for (const asset of [
		"assets/admins.css",
		"assets/admins.js",
		"assets/system.css",
		"assets/system.js",
		"assets/api-management.css",
		"assets/api-management.js",
	]) {
		assert.match(source, new RegExp(asset.replaceAll(".", "\\.")));
	}
});

test("Admin API client covers snapshot/create/toggle/rotate/revoke/mode with CSRF mutations", async () => {
	const source = await readFile(
		new URL("../public/admin/assets/api.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /apiManagement\(\)/);
	assert.match(source, /createApiToken\(payload, csrfToken\)/);
	assert.match(source, /updateApiToken\(id, enabled, csrfToken\)/);
	assert.match(source, /rotateApiToken\(id, payload, csrfToken\)/);
	assert.match(source, /revokeApiToken\(id, csrfToken\)/);
	assert.match(source, /setMarketApiMode\(mode, csrfToken\)/);
	assert.match(source, /X-CSRF-Token/);
});

test("Web API management view is real, bilingual, safe-rendered and never persists raw secrets", async () => {
	const [html, app, feature, i18n] = await Promise.all([
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/api-management.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/i18n.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /id="api-management-view"/);
	assert.match(html, /id="api-secret-panel"/);
	assert.match(html, /data-view="apiManagement"/);
	assert.match(app, /DRDApiManagement\?\.load/);
	assert.match(app, /DRDApiManagement\?\.reset/);
	assert.match(i18n, /apiManagement: "مدیریت API"/);
	assert.match(i18n, /apiManagement: "API Management"/);
	assert.match(feature, /Secret فقط همین یک بار نمایش داده می‌شود/);
	assert.match(feature, /The secret is displayed once only/);
	assert.doesNotMatch(feature, /\.innerHTML\s*=/);
	assert.doesNotMatch(feature, /localStorage|sessionStorage/);
	assert.match(feature, /clearSecret\(\)/);
});

test("Phase 15.3 keeps application version 0.13.0 and schema 12", async () => {
	const source = await readFile(
		new URL("../src/config/app.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /version:\s*"0\.13\.0"/);
	assert.match(source, /schemaVersion:\s*13/);
});
