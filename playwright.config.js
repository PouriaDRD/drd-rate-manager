import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4178/management-test/";

export default defineConfig({
	testDir: "./e2e",
	timeout: 20_000,
	expect: {
		timeout: 5_000,
	},
	fullyParallel: false,
	forbidOnly: true,
	retries: 0,
	workers: 1,
	reporter: [["line"]],
	use: {
		baseURL,
		headless: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "firefox",
			use: { ...devices["Desktop Firefox"] },
		},
		{
			name: "webkit",
			use: { ...devices["Desktop Safari"] },
		},
	],
	webServer: {
		command: "node scripts/serve-admin-e2e.mjs",
		url: baseURL,
		reuseExistingServer: false,
		timeout: 10_000,
	},
});
