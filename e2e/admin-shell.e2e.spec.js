import { expect, test } from "@playwright/test";

const BASE_PATH = "/management-test";
const PROVIDERS = [
	"wallex",
	"tabdeal",
	"exir",
	"bitpin",
	"nobitex",
	"ompfinex",
	"ramzinex",
	"wallgold",
	"technogold",
	"melligold",
	"talasea",
	"milli",
	"gerami",
];

function runtimeProviderEntries() {
	return PROVIDERS.map((source) => ({
		key: `providers.${source}_api_url`,
		category: "providers",
		type: "url",
		value: `https://example.test/${source}`,
		source: "d1",
		default_value: `https://default.example/${source}`,
		legacy_env_key: `${source.toUpperCase()}_API_URL`,
		editable: true,
		rules: {},
	}));
}

function configurationSnapshot() {
	return {
		runtime: {
			version: 3,
			entries: [
				{
					key: "general.timezone",
					category: "general",
					type: "string",
					value: "Asia/Tehran",
					source: "d1",
					default_value: "Asia/Tehran",
					legacy_env_key: "TIMEZONE",
					editable: true,
					rules: {},
				},
				...runtimeProviderEntries(),
			],
		},
		secure: {
			version: 1,
			master_key_configured: true,
			entries: [
				["telegram.bot_token", "TELEGRAM_BOT_TOKEN"],
				["telegram.webhook_secret", "TELEGRAM_WEBHOOK_SECRET"],
				["coingecko.api_key", "COINGECKO_API_KEY"],
				["cloudflare.api_token", "CLOUDFLARE_API_TOKEN"],
			].map(([key, env_key]) => ({
				key,
				category: key.split(".")[0],
				env_key,
				configured: true,
				source: "encrypted_d1",
				editable: true,
				write_only: true,
			})),
		},
		protected: {
			app_name: "DRD RATE MANAGER",
			app_version: "0.2.0",
			app_master_key_configured: true,
			app_master_key_editable: false,
		},
	};
}

function defaultState(overrides = {}) {
	return {
		authenticated: true,
		sessionDelayMs: 0,
		expireApiManagement: false,
		apiManagementStatus: 200,
		loginHistoryStatus: 200,
		...overrides,
	};
}

async function fulfillJson(route, status, payload) {
	await route.fulfill({
		status,
		contentType: "application/json; charset=utf-8",
		body: JSON.stringify(payload),
		headers: {
			"Cache-Control": "no-store",
		},
	});
}

async function installApiMock(page, overrides = {}) {
	const state = defaultState(overrides);
	const requests = [];

	await page.route(`**${BASE_PATH}/api/v1/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname.slice(BASE_PATH.length);
		requests.push({
			path,
			method: request.method(),
			headers: request.headers(),
			body: request.postData(),
		});

		if (path === "/api/v1/auth/session") {
			if (state.sessionDelayMs) {
				await new Promise((resolve) => setTimeout(resolve, state.sessionDelayMs));
			}
			if (!state.authenticated) {
				await fulfillJson(route, 401, { success: false, message: "Unauthorized" });
				return;
			}
			await fulfillJson(route, 200, {
				success: true,
				user: {
					id: 1,
					username: "admin",
					adminPath: "management-test",
					mustCompleteBootstrap: false,
					lastLoginAt: Date.now(),
				},
				csrf_token: "csrf-e2e",
			});
			return;
		}

		if (path === "/api/v1/auth/login") {
			await fulfillJson(route, 401, { success: false, message: "Invalid credentials" });
			return;
		}

		if (path === "/api/v1/auth/logout") {
			await fulfillJson(route, 200, { success: true });
			return;
		}

		if (path === "/api/v1/preferences") {
			await fulfillJson(route, 200, {
				success: true,
				data: {
					admin_ui_language: "fa",
					admin_ui_theme: "dark",
					telegram_language: "fa",
				},
			});
			return;
		}

		if (path === "/api/v1/dashboard") {
			await fulfillJson(route, 200, {
				success: true,
				data: {
					bot_enabled: true,
					market: {
						partial: false,
						usdt: { price_toman: 267691, source: "gold-consensus" },
						cache: { from_cache: false, ttl_seconds: 60 },
					},
					sources: { healthy: 10, total: 13 },
					assets: { enabled: 10, total: 10 },
					automation: {
						last_success_at: Date.now() - 60_000,
						next_publish_at: Date.now() + 60_000,
					},
				},
			});
			return;
		}

		if (path === "/api/v1/api-management") {
			if (state.expireApiManagement) {
				await fulfillJson(route, 401, { success: false, message: "Unauthorized" });
				return;
			}
			if (state.apiManagementStatus !== 200) {
				await fulfillJson(route, state.apiManagementStatus, {
					success: false,
					message: "API management unavailable",
				});
				return;
			}
			await fulfillJson(route, 200, {
				success: true,
				data: {
					market_mode: "private",
					tokens: [
						{
							id: 11,
							name: "E2E Market",
							type: "market",
							prefix: "drd_mkt_e2e",
							enabled: true,
							revoked_at: 0,
							expires_at: 0,
							usage_count: 4,
							last_used_at: Date.now() - 1_000,
							created_at: Date.now() - 10_000,
						},
					],
					stats: {
						total: 1,
						active: 1,
						market: 1,
						core: 0,
						revoked: 0,
					},
					capabilities: { can_manage: true },
				},
			});
			return;
		}

		if (path.startsWith("/api/v1/login-history")) {
			if (state.loginHistoryStatus !== 200) {
				await fulfillJson(route, state.loginHistoryStatus, {
					success: false,
					message: "Login history unavailable",
				});
				return;
			}
			await fulfillJson(route, 200, {
				success: true,
				data: {
					items: [
						{
							id: 7,
							username: "admin",
							result: "success",
							reason: "authenticated",
							ip_address: "203.0.113.10",
							country: "NL",
							city: "Rotterdam",
							user_agent: "E2E Browser",
							cf_ray: "e2e-ray",
							asn: "AS64500",
							timezone: "Europe/Amsterdam",
							session_ref: "session-safe-ref",
							created_at: Date.now(),
						},
					],
					stats: { total: 1, success: 1, failure: 0, locked: 0 },
					pagination: { limit: 25, offset: 0, total: 1, has_more: false },
					filter: { result: "all" },
				},
			});
			return;
		}

		if (path === "/api/v1/configuration") {
			await fulfillJson(route, 200, {
				success: true,
				data: configurationSnapshot(),
			});
			return;
		}

		await fulfillJson(route, 200, { success: true, data: {} });
	});

	return { state, requests };
}

async function startAtView(page, view, options = {}) {
	await page.addInitScript((targetView) => {
		localStorage.setItem("drd-admin-view", targetView);
		localStorage.setItem("drd-admin-lang", "fa");
		localStorage.setItem("drd-admin-theme", "dark");
	}, view);
	const mock = await installApiMock(page, options);
	await page.goto("./");
	return mock;
}

test("authenticated refresh stays behind the boot gate until session resolution", async ({ page }) => {
	await installApiMock(page, { sessionDelayMs: 500 });

	await page.goto("./");

	await expect(page.locator("#boot-screen")).toBeVisible();
	await expect(page.locator("#auth-screen")).toBeHidden();
	await expect(page.locator("#app-shell")).toBeHidden();

	await expect(page.locator("#app-shell")).toBeVisible();
	await expect(page.locator("#boot-screen")).toBeHidden();
	await expect(page.locator("#dashboard-view")).toBeVisible();
});

test("unauthenticated refresh exposes login and never exposes the application shell", async ({ page }) => {
	await installApiMock(page, { authenticated: false });
	await page.goto("./");

	await expect(page.locator("#auth-screen")).toBeVisible();
	await expect(page.locator("#login-form")).toBeVisible();
	await expect(page.locator("#app-shell")).toBeHidden();
});

test("API Management renders real data instead of a blank view", async ({ page }) => {
	await startAtView(page, "apiManagement");

	await expect(page.locator("#api-management-view")).toBeVisible();
	await expect(page.locator("#api-stat-total")).toHaveText("1");
	await expect(page.locator("#api-token-list")).toContainText("E2E Market");
	await expect(page.locator("#api-token-list")).toContainText("drd_mkt_e2e");
});

test("Login History renders persistent security events instead of a blank view", async ({ page }) => {
	await startAtView(page, "loginHistory");

	await expect(page.locator("#login-history-view")).toBeVisible();
	await expect(page.locator("#login-history-total")).toHaveText("1");
	await expect(page.locator("#login-history-list")).toContainText("admin");
	await expect(page.locator("#login-history-list")).toContainText("203.0.113.10");
});

test("Settings exposes every provider and four write-only managed secrets", async ({ page }) => {
	await startAtView(page, "settings");

	await expect(page.locator("#settings-view")).toBeVisible();
	await expect(
		page.locator('#configuration-runtime-groups [data-config-key^="providers."]'),
	).toHaveCount(13);
	await expect(page.locator("#configuration-secure-list form")).toHaveCount(4);
	await expect(page.locator("#configuration-protected-list")).toContainText("APP_MASTER_KEY");
	await expect(page.locator("#configuration-protected-list")).toContainText("تنظیم‌شده");

	const html = await page.locator("#configuration-panel").innerHTML();
	expect(html).not.toContain("must-never-leak");
	expect(html).not.toContain("private-secret-value");
});

test("expired session during an authenticated feature request returns to login immediately", async ({ page }) => {
	await startAtView(page, "dashboard", { expireApiManagement: true });
	await expect(page.locator("#app-shell")).toBeVisible();

	await page.locator('[data-view="apiManagement"]').click();

	await expect(page.locator("#auth-screen")).toBeVisible();
	await expect(page.locator("#login-form")).toBeVisible();
	await expect(page.locator("#app-shell")).toBeHidden();
});

test("feature load failures render visible errors instead of empty panels", async ({ page }) => {
	await startAtView(page, "apiManagement", { apiManagementStatus: 503 });

	await expect(page.locator("#api-management-view")).toBeVisible();
	await expect(page.locator("#api-token-list")).toContainText("API management unavailable");

	await page.evaluate(() => localStorage.setItem("drd-admin-view", "loginHistory"));
	await page.reload();
});

test("Login History load failure renders a visible error state", async ({ page }) => {
	await startAtView(page, "loginHistory", { loginHistoryStatus: 503 });

	await expect(page.locator("#login-history-view")).toBeVisible();
	await expect(page.locator("#login-history-list")).toContainText("Login history unavailable");
});

test("mobile navigation opens, navigates and closes without hiding the target view", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await startAtView(page, "dashboard");

	await page.locator("#sidebar-open").click();
	await expect(page.locator("#sidebar")).toHaveClass(/is-open/);

	await page.locator('[data-view="settings"]').click();

	await expect(page.locator("#settings-view")).toBeVisible();
	await expect(page.locator("#sidebar")).not.toHaveClass(/is-open/);
	await expect(page.locator("#app-shell")).toBeVisible();
});
