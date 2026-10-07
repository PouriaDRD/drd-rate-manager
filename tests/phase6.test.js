import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WebAdminAuthController } from "../src/controllers/web-admin-auth.controller.js";
import { WebAdminUiController } from "../src/controllers/web-admin-ui.controller.js";
import { I18N_LANGUAGES, t } from "../public/admin/assets/i18n.js";

function controller() {
	const requested = [];
	const instance = new WebAdminUiController({
		webAuth: {
			async routingState() {
				return { adminPath: "management-x8k2", mustCompleteBootstrap: false };
			},
		},
		rawEnv: {
			ASSETS: {
				async fetch(request) {
					const url = new URL(request.url);
					requested.push(url.pathname);
					if (url.pathname === "/") {
						return new Response("<!doctype html><title>Admin</title>", {
							status: 200,
							headers: { "Content-Type": "text/html; charset=utf-8" },
						});
					}
					if (url.pathname === "/assets/styles.css") {
						return new Response(":root{}", {
							status: 200,
							headers: { "Content-Type": "text/css; charset=utf-8" },
						});
					}
					if (url.pathname === "/assets/login-history.css") {
						return new Response(".login-history{}", {
							status: 200,
							headers: { "Content-Type": "text/css; charset=utf-8" },
						});
					}
					if (url.pathname === "/assets/login-history.js") {
						return new Response("export {};", {
							status: 200,
							headers: { "Content-Type": "text/javascript; charset=utf-8" },
						});
					}
					return new Response("missing", { status: 404 });
				},
			},
		},
	});
	return { instance, requested };
}

function assertPrivateNoStore(response) {
	const cacheControl = response.headers.get("Cache-Control") || "";
	assert.match(cacheControl, /no-store/);
	assert.match(cacheControl, /no-cache/);
	assert.match(cacheControl, /must-revalidate/);
	assert.match(cacheControl, /private/);
	assert.doesNotMatch(cacheControl, /(?:^|,\s*)public(?:,|$)/);
	assert.doesNotMatch(cacheControl, /max-age=[1-9]/);
	assert.equal(response.headers.get("Pragma"), "no-cache");
	assert.equal(response.headers.get("Expires"), "0");
}

test("admin shell redirects the dynamic admin path to a trailing slash", async () => {
	const { instance } = controller();
	const request = new Request("https://example.test/management-x8k2?from=test");
	const response = await instance.route(request, new URL(request.url));
	assert.equal(response.status, 308);
	assert.equal(response.headers.get("Location"), "https://example.test/management-x8k2/?from=test");
	assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("admin shell is served through canonical ASSETS root with private no-store UI CSP", async () => {
	const { instance, requested } = controller();
	const request = new Request("https://example.test/management-x8k2/");
	const response = await instance.route(request, new URL(request.url));
	assert.equal(response.status, 200);
	assert.deepEqual(requested, ["/"]);
	assertPrivateNoStore(response);
	assert.match(response.headers.get("Content-Security-Policy"), /script-src 'self'/);
	assert.match(response.headers.get("Content-Security-Policy"), /connect-src 'self'/);
	assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("dynamic-path assets map to the static binding and are never cacheable", async () => {
	const { instance, requested } = controller();
	const request = new Request("https://example.test/management-x8k2/assets/styles.css");
	const response = await instance.route(request, new URL(request.url));
	assert.equal(response.status, 200);
	assert.deepEqual(requested, ["/assets/styles.css"]);
	assertPrivateNoStore(response);
});

test("login history assets are available through the private dynamic path without caching", async () => {
	const css = controller();
	const cssRequest = new Request("https://example.test/management-x8k2/assets/login-history.css");
	const cssResponse = await css.instance.route(cssRequest, new URL(cssRequest.url));
	assert.equal(cssResponse.status, 200);
	assert.deepEqual(css.requested, ["/assets/login-history.css"]);
	assertPrivateNoStore(cssResponse);

	const js = controller();
	const jsRequest = new Request("https://example.test/management-x8k2/assets/login-history.js");
	const jsResponse = await js.instance.route(jsRequest, new URL(jsRequest.url));
	assert.equal(jsResponse.status, 200);
	assert.deepEqual(js.requested, ["/assets/login-history.js"]);
	assertPrivateNoStore(jsResponse);
});

test("admin UI does not intercept API routes or unrelated paths", async () => {
	const { instance } = controller();
	const apiRequest = new Request("https://example.test/management-x8k2/api/v1/auth/session");
	const unrelated = new Request("https://example.test/assets/app.js");
	assert.equal(await instance.route(apiRequest, new URL(apiRequest.url)), null);
	assert.equal(await instance.route(unrelated, new URL(unrelated.url)), null);
});

test("unknown files under the admin path are not exposed", async () => {
	const { instance, requested } = controller();
	const request = new Request("https://example.test/management-x8k2/package.json");
	const response = await instance.route(request, new URL(request.url));
	assert.equal(response.status, 404);
	assert.deepEqual(requested, []);
});

test("wrangler routes every request through Worker before static admin assets", async () => {
	const source = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
	const config = JSON.parse(source);
	assert.deepEqual(config.assets, {
		directory: "./public/admin",
		binding: "ASSETS",
		run_worker_first: true,
	});
});

test("admin HTML is CSP-friendly and contains login, bootstrap and shell surfaces", async () => {
	const html = await readFile(new URL("../public/admin/index.html", import.meta.url), "utf8");
	assert.match(html, /id="login-form"/);
	assert.match(html, /id="bootstrap-form"/);
	assert.match(html, /id="app-shell"/);
	assert.match(html, /href="assets\/styles\.css"/);
	assert.match(html, /href="assets\/login-history\.css"/);
	assert.match(html, /src="assets\/app\.js"/);
	assert.doesNotMatch(html, /<style[\s>]/i);
	assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
});

test("FA and EN translations are both available for the primary shell", () => {
	assert.deepEqual(I18N_LANGUAGES, ["fa", "en"]);
	assert.equal(t("fa", "dashboard"), "داشبورد");
	assert.equal(t("en", "dashboard"), "Dashboard");
	assert.equal(t("fa", "settings"), "تنظیمات");
	assert.equal(t("en", "settings"), "Settings");
});

test("frontend keeps CSRF in runtime state rather than browser storage", async () => {
	const app = await readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8");
	assert.match(app, /csrfToken:\s*""/);
	assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*(csrf|token|session)/i);
	assert.match(app, /drd-admin-theme/);
	assert.match(app, /drd-admin-lang/);
});

test("theme system defines separate dark/light tokens and responsive navigation", async () => {
	const css = await readFile(new URL("../public/admin/assets/styles.css", import.meta.url), "utf8");
	assert.match(css, /:root\s*\{/);
	assert.match(css, /:root\[data-theme="light"\]/);
	assert.match(css, /@media \(max-width: 860px\)/);
	assert.match(css, /\.sidebar\.is-open/);
	assert.match(css, /prefers-reduced-motion/);
});

test("frontend supports System, Dark and Light without storing sensitive session data", async () => {
	const app = await readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8");
	const api = await readFile(new URL("../public/admin/assets/api.js", import.meta.url), "utf8");
	assert.match(app, /THEME_ORDER = \["system", "dark", "light"\]/);
	assert.match(app, /prefers-color-scheme: dark/);
	assert.match(api, /credentials: "same-origin"/);
});

test("Phase 5 auth controller yields the shell route to the UI controller", async () => {
	const authController = new WebAdminAuthController({
		webAuth: {
			async routingState() {
				return { adminPath: "secret-panel", mustCompleteBootstrap: false };
			},
		},
	});
	const request = new Request("https://example.test/secret-panel");
	assert.equal(await authController.route(request, new URL(request.url)), null);
});

test("admin authentication API remains isolated under the dynamic /api path", async () => {
	const authController = new WebAdminAuthController({
		webAuth: {
			async routingState() {
				return { adminPath: "secret-panel", mustCompleteBootstrap: false };
			},
			async login(_request, username, password) {
				assert.equal(username, "admin");
				assert.equal(password, "admin");
				return {
					ok: true,
					status: 200,
					user: { username: "admin", mustCompleteBootstrap: true },
					csrfToken: "csrf",
					cookie: "__Host-drd_admin_session=test; Path=/; HttpOnly; Secure; SameSite=Strict",
				};
			},
		},
	});
	const request = new Request("https://example.test/secret-panel/api/v1/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username: "admin", password: "admin" }),
	});
	const response = await authController.route(request, new URL(request.url));
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
	assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
});
