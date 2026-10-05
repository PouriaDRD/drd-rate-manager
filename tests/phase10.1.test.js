import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	ADMIN_MANAGEMENT_POLICY,
	AdminManagementService,
} from "../src/services/admin-management.service.js";
import { WebAdminAdminsController } from "../src/controllers/web-admin-admins.controller.js";

class FakeAdmins {
	constructor(rows = []) {
		this.rows = new Map(rows.map((row) => [String(row.user_id), { ...row }]));
	}

	async list() {
		return [...this.rows.values()];
	}

	async get(userId) {
		return this.rows.get(String(userId)) || null;
	}

	async add(userId, addedBy) {
		const id = String(userId);
		const existing = this.rows.get(id);
		const now = Date.now();
		const row = existing || {
			user_id: id,
			username: null,
			first_name: null,
			last_name: null,
			created_at: now,
		};
		Object.assign(row, { is_active: 1, added_by: row.added_by || addedBy, updated_at: now });
		this.rows.set(id, row);
		return row;
	}

	async setEnabled(userId, enabled) {
		const row = this.rows.get(String(userId));
		if (!row) throw new Error("Admin not found");
		row.is_active = enabled ? 1 : 0;
		row.updated_at = Date.now();
		return enabled;
	}

	async remove(userId) {
		return this.rows.delete(String(userId));
	}
}

class FakeAudit {
	constructor() {
		this.rows = [];
	}
	async add(userId, action, data) {
		this.rows.push({ userId, action, data });
	}
}

const ownerActor = { type: "web", role: "owner", id: "1" };
const adminActor = { type: "telegram", role: "admin", id: "200000" };

function service(rows = []) {
	const admins = new FakeAdmins(rows);
	const audit = new FakeAudit();
	const instance = new AdminManagementService({ ownerId: "100000" }, admins, audit);
	return { instance, admins, audit };
}

test("admin management snapshot includes immutable owner and normalized admin records", async () => {
	const { instance } = service([{
		user_id: "200000",
		username: "pouria",
		first_name: "Pouria",
		last_name: "D",
		is_active: 1,
		added_by: "telegram:100000",
		created_at: 100,
		updated_at: 200,
	}]);
	const snapshot = await instance.snapshot(adminActor);
	assert.equal(snapshot.admins.length, 2);
	assert.deepEqual(snapshot.admins[0], {
		userId: "100000",
		role: "owner",
		active: true,
		immutable: true,
		username: null,
		firstName: null,
		lastName: null,
		displayName: "Owner",
		addedBy: null,
		createdAt: 0,
		updatedAt: 0,
	});
	assert.equal(snapshot.admins[1].displayName, "Pouria D");
	assert.equal(snapshot.stats.activeAdmins, 1);
	assert.equal(snapshot.capabilities.canManage, false);
});

test("only owner can mutate administrators while admins remain read-only", async () => {
	const { instance } = service();
	await assert.rejects(
		() => instance.add("300000", adminActor),
		(error) => error.statusCode === 403 && error.code === "owner_required",
	);
	const added = await instance.add("300000", ownerActor);
	assert.equal(added.userId, "300000");
	assert.equal(added.active, true);
});

test("owner record is immutable across add, status and delete operations", async () => {
	const { instance } = service();
	for (const action of [
		() => instance.add("100000", ownerActor),
		() => instance.setEnabled("100000", false, ownerActor),
		() => instance.remove("100000", ownerActor),
	]) {
		await assert.rejects(
			action,
			(error) => error.statusCode === 409 && error.code === "owner_immutable",
		);
	}
	assert.equal(ADMIN_MANAGEMENT_POLICY.ownerMutable, false);
});

test("enabled state is idempotent and every mutation is centrally audited", async () => {
	const { instance, audit } = service([{
		user_id: "300000",
		is_active: 1,
		added_by: "web:1",
		created_at: 100,
		updated_at: 100,
	}]);
	const disabled = await instance.setEnabled("300000", false, ownerActor);
	assert.equal(disabled.active, false);
	const disabledAgain = await instance.setEnabled("300000", false, ownerActor);
	assert.equal(disabledAgain.active, false);
	await instance.setEnabled("300000", true, ownerActor);
	await instance.remove("300000", ownerActor);
	assert.deepEqual(
		audit.rows.map((row) => row.action),
		["admin.disabled", "admin.disabled", "admin.enabled", "admin.removed"],
	);
	assert.equal(audit.rows[0].data.actorType, "web");
	assert.equal(audit.rows[0].data.actorRole, "owner");
});

test("Telegram IDs are normalized and invalid values fail before repository access", async () => {
	const { instance } = service();
	assert.equal(instance.normalizeTelegramId("۱۲۳۴۵۶"), "123456");
	for (const invalid of ["", "1234", "abc123", "123456789012345678901"]) {
		assert.throws(
			() => instance.normalizeTelegramId(invalid),
			(error) => error.statusCode === 400 && error.code === "invalid_telegram_id",
		);
	}
});

function controllerServices() {
	const calls = [];
	const management = {
		async snapshot(actor) {
			calls.push(["snapshot", actor]);
			return {
				admins: [{
					userId: "100000",
					role: "owner",
					active: true,
					immutable: true,
					username: null,
					firstName: null,
					lastName: null,
					displayName: "Owner",
					addedBy: null,
					createdAt: 0,
					updatedAt: 0,
				}],
				stats: { total: 1, activeAdmins: 0, inactiveAdmins: 0, ownerConfigured: true },
				capabilities: { canManage: true },
			};
		},
		async add(userId, actor) {
			calls.push(["add", userId, actor]);
			return {
				userId: String(userId),
				role: "admin",
				active: true,
				immutable: false,
				username: null,
				firstName: null,
				lastName: null,
				displayName: String(userId),
				addedBy: "web:1",
				createdAt: 100,
				updatedAt: 100,
			};
		},
		async get(userId, actor) {
			calls.push(["get", userId, actor]);
			return {
				userId: String(userId),
				role: "admin",
				active: true,
				immutable: false,
				username: null,
				firstName: null,
				lastName: null,
				displayName: String(userId),
				addedBy: "web:1",
				createdAt: 100,
				updatedAt: 200,
			};
		},
		async setEnabled(userId, enabled, actor) {
			calls.push(["setEnabled", userId, enabled, actor]);
			return {
				userId: String(userId),
				role: "admin",
				active: enabled,
				immutable: false,
				username: null,
				firstName: null,
				lastName: null,
				displayName: String(userId),
				addedBy: "web:1",
				createdAt: 100,
				updatedAt: 300,
			};
		},
		async remove(userId, actor) {
			calls.push(["remove", userId, actor]);
			return { removed: true, userId: String(userId) };
		},
	};
	return {
		calls,
		services: {
			webAuth: {
				async routingState() { return { adminPath: "secure" }; },
				async authenticate(_request, options) {
					calls.push(["authenticate", options]);
					return { user: { id: 1, must_complete_bootstrap: 0 } };
				},
			},
			adminManagement: management,
		},
	};
}

test("Web Admin list/add endpoints are authenticated and mutations require CSRF", async () => {
	const { services, calls } = controllerServices();
	const controller = new WebAdminAdminsController(services);

	let response = await controller.route(
		new Request("https://example.test/secure/api/v1/admins"),
		new URL("https://example.test/secure/api/v1/admins"),
	);
	assert.equal(response.status, 200);
	let payload = await response.json();
	assert.equal(payload.data.stats.owner_configured, true);
	assert.deepEqual(calls[0], ["authenticate", { requireCsrf: false }]);

	response = await controller.route(
		new Request("https://example.test/secure/api/v1/admins", {
			method: "POST",
			body: JSON.stringify({ user_id: "300000" }),
		}),
		new URL("https://example.test/secure/api/v1/admins"),
	);
	assert.equal(response.status, 201);
	payload = await response.json();
	assert.equal(payload.data.user_id, "300000");
	assert.ok(calls.some((call) => call[0] === "authenticate" && call[1].requireCsrf === true));
	assert.ok(calls.some((call) => call[0] === "add" && call[2].role === "owner"));
});

test("Web Admin detail supports GET, idempotent PATCH and DELETE", async () => {
	const { services, calls } = controllerServices();
	const controller = new WebAdminAdminsController(services);
	const url = "https://example.test/secure/api/v1/admins/300000";

	let response = await controller.route(new Request(url), new URL(url));
	assert.equal(response.status, 200);

	response = await controller.route(
		new Request(url, { method: "PATCH", body: JSON.stringify({ enabled: false }) }),
		new URL(url),
	);
	assert.equal(response.status, 200);
	let payload = await response.json();
	assert.equal(payload.data.active, false);

	response = await controller.route(
		new Request(url, { method: "DELETE" }),
		new URL(url),
	);
	assert.equal(response.status, 200);
	payload = await response.json();
	assert.equal(payload.data.removed, true);
	assert.ok(calls.some((call) => call[0] === "setEnabled"));
	assert.ok(calls.some((call) => call[0] === "remove"));
});

test("Web Admin admin controller yields unrelated API paths", async () => {
	const { services, calls } = controllerServices();
	const controller = new WebAdminAdminsController(services);
	const url = new URL("https://example.test/secure/api/v1/market");
	assert.equal(await controller.route(new Request(url), url), null);
	assert.equal(calls.length, 0);
});

test("composition root and application wire the dedicated admin management boundary", async () => {
	const [container, application] = await Promise.all([
		readFile(new URL("../src/app/container.js", import.meta.url), "utf8"),
		readFile(new URL("../src/app/application.js", import.meta.url), "utf8"),
	]);
	assert.match(container, /new AdminManagementService\(config, admins, audit\)/);
	assert.match(container, /adminManagement,/);
	assert.match(application, /new WebAdminAdminsController\(this\.services\)/);
	assert.match(application, /webAdminAdmins\.route/);
});

test("repository keeps legacy toggle while adding explicit idempotent setEnabled", async () => {
	const repository = await readFile(
		new URL("../src/repositories/admin.repository.js", import.meta.url),
		"utf8",
	);
	assert.match(repository, /async setEnabled\(userId, enabled\)/);
	assert.match(repository, /async toggle\(userId\)/);
	assert.match(repository, /return this\.setEnabled/);
});
