import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Login History browser fixture follows the Web API ip_address serializer contract", async () => {
	const source = await readFile(
		new URL("../e2e/admin-shell.e2e.spec.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /ip_address:\s*"203\.0\.113\.10"/);
	assert.doesNotMatch(source, /\n\s*ip:\s*"203\.0\.113\.10"/);
});


test("Web Admin view activation maps camelCase feature keys to real kebab-case DOM ids", async () => {
	const [app, html] = await Promise.all([
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
	]);

	assert.match(app, /apiManagement: "api-management-view"/);
	assert.match(app, /loginHistory: "login-history-view"/);
	assert.match(app, /Object\.entries\(VIEW_ELEMENT_IDS\)/);
	assert.match(app, /document\.querySelector\(\`#\$\{elementId\}\`\)/);
	assert.doesNotMatch(app, /document\.querySelector\(\`#\$\{key\}-view\`\)/);

	assert.match(html, /id="api-management-view"/);
	assert.match(html, /id="login-history-view"/);
});


test("Phase 19.8C pins a real-browser E2E runner and keeps it isolated from node --test", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.equal(pkg.devDependencies["@playwright/test"], "1.63.0");
	assert.equal(pkg.scripts["test:browser"], "playwright test");
	assert.match(pkg.scripts["test:browser:chromium"], /--project=chromium/);
	assert.match(pkg.scripts["test:hardening"], /test:phase19\.8/);
	assert.match(pkg.scripts["test:hardening"], /test:browser/);
});

test("Playwright runs the admin suite in Chromium Firefox and WebKit with failure evidence", async () => {
	const source = await readFile(new URL("../playwright.config.js", import.meta.url), "utf8");
	for (const browser of ["chromium", "firefox", "webkit"]) {
		assert.match(source, new RegExp(`name: "${browser}"`));
	}
	assert.match(source, /trace: "retain-on-failure"/);
	assert.match(source, /screenshot: "only-on-failure"/);
	assert.match(source, /video: "retain-on-failure"/);
	assert.match(source, /workers: 1/);
});

test("browser fixture serves only the private admin tree with no-store semantics", async () => {
	const source = await readFile(
		new URL("../scripts/serve-admin-e2e.mjs", import.meta.url),
		"utf8",
	);
	assert.match(source, /management-test/);
	assert.match(source, /no-store, no-cache, must-revalidate, private/);
	assert.match(source, /candidate !== ROOT && !candidate\.startsWith\(rootPrefix\)/);
	assert.match(source, /E2E API route was not mocked/);
});

test("browser E2E covers boot gating blank-view regressions configuration session expiry errors and mobile navigation", async () => {
	const source = await readFile(
		new URL("../e2e/admin-shell.e2e.spec.js", import.meta.url),
		"utf8",
	);
	for (const phrase of [
		"authenticated refresh stays behind the boot gate",
		"API Management renders real data instead of a blank view",
		"Login History renders persistent security events instead of a blank view",
		"Settings exposes every provider and four write-only managed secrets",
		"expired session during an authenticated feature request",
		"feature load failures render visible errors instead of empty panels",
		"mobile navigation opens, navigates and closes",
	]) {
		assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
	assert.match(source, /toHaveCount\(13\)/);
	assert.match(source, /toHaveCount\(4\)/);
});

test("AdminApi emits an explicit session-expired signal on authenticated 401 responses", async () => {
	const source = await readFile(
		new URL("../public/admin/assets/api.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /drd-admin-session-expired/);
	assert.match(source, /response\.status === 401/);
	assert.match(source, /path !== "\/api\/v1\/auth\/login"/);
});

test("Admin shell consumes session expiry centrally and clears feature state before login", async () => {
	const source = await readFile(
		new URL("../public/admin/assets/app.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /addEventListener\("drd-admin-session-expired", handleSessionExpired\)/);
	assert.match(source, /function handleSessionExpired\(\)/);
	assert.match(source, /apiManagementView\.reset\(\)/);
	assert.match(source, /loginHistoryView\.reset\(\)/);
	assert.match(source, /configurationView\.reset\(\)/);
	assert.match(source, /state\.csrfToken = ""/);
	assert.match(source, /showLogin\(\)/);
});

test("session expiry has deterministic Persian and English copy", async () => {
	const source = await readFile(
		new URL("../public/admin/assets/i18n.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /sessionExpired: "نشست مدیریت منقضی شده است\. دوباره وارد شوید\."/);
	assert.match(source, /sessionExpired: "Your admin session has expired\. Sign in again\."/);
});

test("browser artifacts are ignored and application identity remains unchanged", async () => {
	const [ignore, app] = await Promise.all([
		readFile(new URL("../.gitignore", import.meta.url), "utf8"),
		readFile(new URL("../src/config/app.js", import.meta.url), "utf8"),
	]);
	assert.match(ignore, /^playwright-report\/$/m);
	assert.match(ignore, /^test-results\/$/m);
	assert.match(app, /version:\s*"0\.2\.0"/);
	assert.match(app, /schemaVersion:\s*13/);
});
