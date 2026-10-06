import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WebAdminDataController } from "../src/controllers/web-admin-data.controller.js";

function historyServices({ authenticated = true } = {}) {
	const calls = { authenticate: [], list: [], stats: 0 };
	const services = {
		webAuth: {
			async routingState() { return { adminPath: "admin" }; },
			async authenticate(_request, options) {
				calls.authenticate.push(options);
				return authenticated
					? { user: { id: 1, must_complete_bootstrap: 0 } }
					: null;
			},
		},
		loginHistory: {
			async list(options) {
				calls.list.push(options);
				return [
					{
						id: 9,
						userId: 1,
						username: "admin",
						result: "success",
						reason: "authenticated",
						ipAddress: "203.0.113.9",
						userAgent: "Phase16.2-Test",
						cfRay: "ray-162",
						country: "NL",
						region: "South Holland",
						city: "Rotterdam",
						timezone: "Europe/Amsterdam",
						asn: 64512,
						sessionRef: "abcdef0123456789",
						createdAt: 1_760_000_000_000,
						password: "must-not-leak",
						tokenHash: "must-not-leak",
					},
				];
			},
			async stats() {
				calls.stats += 1;
				return { total: 5, success: 3, failure: 1, locked: 1 };
			},
		},
	};
	return { services, calls };
}

function request(path, method = "GET") {
	return new Request(`https://example.test${path}`, { method });
}

test("Web Admin login history GET is authenticated, read-only and CSRF-free", async () => {
	const { services, calls } = historyServices();
	const controller = new WebAdminDataController(services);
	const req = request("/admin/api/v1/login-history?limit=2&offset=1&result=success");
	const response = await controller.route(req, new URL(req.url));
	const payload = await response.json();
	assert.equal(response.status, 200);
	assert.deepEqual(calls.authenticate, [{ requireCsrf: false }]);
	assert.deepEqual(calls.list, [{ limit: 2, offset: 1, result: "success" }]);
	assert.equal(calls.stats, 1);
	assert.equal(payload.data.filter.result, "success");
	assert.equal(payload.data.pagination.total, 3);
	assert.equal(payload.data.pagination.has_more, true);
});

test("login history endpoint validates bounded pagination and result filters", async () => {
	const { services, calls } = historyServices();
	const controller = new WebAdminDataController(services);
	for (const suffix of ["?limit=101", "?limit=nope", "?offset=-1", "?result=unknown"]) {
		const req = request(`/admin/api/v1/login-history${suffix}`);
		const response = await controller.route(req, new URL(req.url));
		assert.equal(response.status, 400);
	}
	assert.equal(calls.list.length, 0);
});

test("unauthenticated login history requests fail before history service access", async () => {
	const { services, calls } = historyServices({ authenticated: false });
	const controller = new WebAdminDataController(services);
	const req = request("/admin/api/v1/login-history");
	const response = await controller.route(req, new URL(req.url));
	assert.equal(response.status, 401);
	assert.equal(calls.list.length, 0);
	assert.equal(calls.stats, 0);
});

test("login history Web API serializes only safe security metadata", async () => {
	const { services } = historyServices();
	const controller = new WebAdminDataController(services);
	const req = request("/admin/api/v1/login-history");
	const response = await controller.route(req, new URL(req.url));
	const payload = await response.json();
	const row = payload.data.items[0];
	assert.deepEqual(Object.keys(row).sort(), [
		"asn", "cf_ray", "city", "country", "created_at", "id", "ip_address",
		"reason", "region", "result", "session_ref", "timezone", "user_agent",
		"user_id", "username",
	].sort());
	assert.equal(row.session_ref, "abcdef0123456789");
	assert.equal(JSON.stringify(payload).includes("must-not-leak"), false);
});

test("Web Admin shell exposes Login History as a real first-class view", async () => {
	const [html, app, api, i18n] = await Promise.all([
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/api.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/i18n.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /data-view="loginHistory"/);
	assert.match(html, /id="login-history-view"/);
	assert.match(html, /assets\/login-history\.css/);
	assert.match(html, /assets\/login-history\.js/);
	assert.match(app, /loginHistory:\s*\{\s*index:\s*"08"/);
	assert.match(app, /window\.DRDLoginHistory\?\.load/);
	assert.match(app, /window\.DRDLoginHistory\?\.render/);
	assert.match(api, /loginHistory\(\{ limit = 25, offset = 0, result = "all" \} = \{\}\)/);
	assert.match(i18n, /loginHistory:\s*"امنیت ورود"/);
	assert.match(i18n, /loginHistory:\s*"Login Security"/);
});

test("Login History UI renders untrusted metadata with safe DOM primitives", async () => {
	const source = await readFile(
		new URL("../public/admin/assets/login-history.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /document\.createElement/);
	assert.match(source, /textContent/);
	assert.match(source, /session_ref/);
	assert.match(source, /cf_ray/);
	assert.match(source, /pagination/);
	assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
	assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("Login History UI is bilingual, filterable, paginated and responsive", async () => {
	const [source, css] = await Promise.all([
		readFile(new URL("../public/admin/assets/login-history.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/login-history.css", import.meta.url), "utf8"),
	]);
	assert.match(source, /success.*failure.*locked/s);
	assert.match(source, /login-history-filter/);
	assert.match(source, /login-history-prev/);
	assert.match(source, /login-history-next/);
	assert.match(source, /fa:\s*\{/);
	assert.match(source, /en:\s*\{/);
	assert.match(css, /var\(--panel\)/);
	assert.match(css, /var\(--border\)/);
	assert.match(css, /@media \(max-width: 640px\)/);
	assert.match(css, /prefers-reduced-motion/);
});

test("Phase 16.2 reuses Phase 16.1 service and adds no schema or app-version change", async () => {
	const [controller, container, appConfig, database] = await Promise.all([
		readFile(new URL("../src/controllers/web-admin-data.controller.js", import.meta.url), "utf8"),
		readFile(new URL("../src/app/container.js", import.meta.url), "utf8"),
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
		readFile(new URL("../src/database/database.js", import.meta.url), "utf8"),
	]);
	assert.match(controller, /this\.s\.loginHistory\.list/);
	assert.match(controller, /this\.s\.loginHistory\.stats/);
	assert.doesNotMatch(controller, /DB\.prepare/);
	assert.equal((container.match(/new LoginHistoryService\(/g) || []).length, 1);
	assert.match(appConfig, /version:\s*"0\.13\.0"/);
	assert.match(appConfig, /schemaVersion:\s*13/);
	assert.equal((database.match(/CREATE TABLE IF NOT EXISTS web_admin_login_history/g) || []).length, 1);
});
