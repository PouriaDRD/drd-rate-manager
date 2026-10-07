import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createServices } from "../src/app/container.js";

import { RUNTIME_SETTING_DEFINITIONS, RUNTIME_SETTINGS_VERSION } from "../src/config/runtime-settings.js";
import { SECURE_SETTING_KEYS } from "../src/config/secure-settings.js";
import { WebAdminConfigurationController } from "../src/controllers/web-admin-configuration.controller.js";
import { ConfigurationManagementService } from "../src/services/configuration-management.service.js";

function compositionFakeStatement() {
	return {
		bind() {
			return this;
		},
		async first() {
			return { count: 0, ok: 1 };
		},
		async all() {
			return { results: [] };
		},
		async run() {
			return { meta: { changes: 1 } };
		},
	};
}

function compositionFakeDb() {
	return {
		prepare() {
			return compositionFakeStatement();
		},
		async batch(statements) {
			return Promise.all(statements.map((statement) => statement.run?.() ?? null));
		},
	};
}

function fakeSettingsService() {
	const values = Object.fromEntries(
		RUNTIME_SETTING_DEFINITIONS.map((item) => [item.key, item.defaultValue]),
	);
	const sources = Object.fromEntries(
		RUNTIME_SETTING_DEFINITIONS.map((item) => [item.key, "default"]),
	);
	return {
		values,
		sources,
		get(key) {
			return values[key];
		},
		getSource(key) {
			return sources[key] || "default";
		},
		async setMany(next) {
			for (const [key, value] of Object.entries(next)) {
				const definition = RUNTIME_SETTING_DEFINITIONS.find((item) => item.key === key);
				if (!definition) throw new Error(`Unknown runtime setting: ${key}`);
				values[key] = value;
				sources[key] = "d1";
			}
		},
	};
}

function fakeSecureSettingsService() {
	const status = {
		masterKeyConfigured: true,
		secrets: Object.fromEntries(
			SECURE_SETTING_KEYS.map((key) => [
				key,
				{ configured: true, source: "encrypted_d1" },
			]),
		),
	};
	const writes = [];
	return {
		writes,
		status() {
			return structuredClone(status);
		},
		async set(key, value) {
			writes.push([key, value]);
			status.secrets[key] = { configured: Boolean(value), source: "encrypted_d1" };
		},
	};
}

function serviceHarness() {
	const settingsService = fakeSettingsService();
	const secureSettingsService = fakeSecureSettingsService();
	const audits = [];
	const passwordChecks = [];
	const service = new ConfigurationManagementService({
		settingsService,
		secureSettingsService,
		audit: {
			async add(actor, action, data) {
				audits.push({ actor, action, data });
			},
		},
		webAuth: {
			async confirmPassword(authenticated, value) {
				passwordChecks.push([authenticated, value]);
				if (value !== "correct-password") {
					throw Object.assign(new Error("Current password is incorrect."), {
						statusCode: 403,
						code: "password_confirmation_failed",
					});
				}
			},
		},
		rawEnv: {
			APP_NAME: "DRD RATE MANAGER",
			APP_VERSION: "0.2.0",
			APP_MASTER_KEY: "must-never-leak",
		},
	});
	return {
		service,
		settingsService,
		secureSettingsService,
		audits,
		passwordChecks,
	};
}

test("Phase 19.8B composition root constructs configuration management without TDZ/self-reference", () => {
	const env = { DB: compositionFakeDb() };
	const services = createServices(env);

	assert.ok(services.configurationManagement);
	assert.equal(
		services.configurationManagement.settingsService,
		services.settingsService,
	);
	assert.equal(
		services.configurationManagement.secureSettingsService,
		services.secureSettingsService,
	);
	assert.equal(
		services.configurationManagement.webAuth,
		services.webAuth,
	);
	assert.equal(services.configurationManagement.rawEnv, env);
});

test("Phase 19.8B advances runtime catalog version without changing schema/app version", async () => {
	assert.equal(RUNTIME_SETTINGS_VERSION, 3);
	const app = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(app, /version:\s*"0\.2\.0"/);
	assert.match(app, /schemaVersion:\s*13/);
});

test("configuration snapshot exposes all runtime settings and all secure statuses without secret plaintext", () => {
	const { service } = serviceHarness();
	const snapshot = service.snapshot();

	assert.equal(snapshot.runtime.entries.length, RUNTIME_SETTING_DEFINITIONS.length);
	assert.equal(snapshot.runtime.entries.filter((item) => item.category === "providers").length, 13);
	assert.deepEqual(
		new Set(snapshot.secure.entries.map((item) => item.key)),
		new Set(SECURE_SETTING_KEYS),
	);
	assert.ok(snapshot.secure.entries.every((item) => item.write_only === true));
	assert.equal(snapshot.protected.app_master_key_configured, true);
	assert.equal(snapshot.protected.app_master_key_editable, false);

	const json = JSON.stringify(snapshot);
	assert.doesNotMatch(json, /must-never-leak/);
	assert.doesNotMatch(json, /correct-password/);
});

test("runtime configuration update persists managed keys and audits key names only", async () => {
	const { service, settingsService, audits } = serviceHarness();
	const result = await service.updateRuntime(
		{
			"general.timezone": "Europe/Amsterdam",
			"providers.bitpin_api_url": "https://example.test/bitpin",
		},
		{ id: "1" },
	);
	assert.equal(settingsService.values["general.timezone"], "Europe/Amsterdam");
	assert.equal(
		settingsService.values["providers.bitpin_api_url"],
		"https://example.test/bitpin",
	);
	assert.equal(result.runtime.entries.find((x) => x.key === "general.timezone").source, "d1");
	assert.deepEqual(audits, [
		{
			actor: "1",
			action: "web.configuration.runtime_updated",
			data: {
				keys: ["general.timezone", "providers.bitpin_api_url"],
			},
		},
	]);
});

test("runtime configuration rejects unknown, empty and non-object payloads", async () => {
	const { service } = serviceHarness();
	await assert.rejects(
		() => service.updateRuntime({ "unknown.key": "x" }, { id: "1" }),
		/Unknown runtime setting/,
	);
	await assert.rejects(
		() => service.updateRuntime({}, { id: "1" }),
		/At least one runtime setting/,
	);
	await assert.rejects(
		() => service.updateRuntime([], { id: "1" }),
		/payload must be an object/,
	);
});

test("secure replacement requires current password and never audits secret plaintext", async () => {
	const { service, secureSettingsService, audits, passwordChecks } = serviceHarness();

	await assert.rejects(
		() =>
			service.replaceSecret(
				{
					key: "coingecko.api_key",
					value: "cg-secret-value",
					currentPassword: "wrong",
					authenticated: { user: { id: 1 } },
				},
				{ id: 1 },
			),
		/Current password is incorrect/,
	);
	assert.equal(secureSettingsService.writes.length, 0);

	const result = await service.replaceSecret(
		{
			key: "coingecko.api_key",
			value: "cg-secret-value",
			currentPassword: "correct-password",
			authenticated: { user: { id: 1 } },
		},
		{ id: 1 },
	);
	assert.deepEqual(secureSettingsService.writes, [
		["coingecko.api_key", "cg-secret-value"],
	]);
	assert.equal(result.key, "coingecko.api_key");
	assert.equal(result.configured, true);
	assert.equal(result.write_only, true);
	assert.equal(passwordChecks.length, 2);
	assert.equal(JSON.stringify(audits).includes("cg-secret-value"), false);
	assert.deepEqual(audits.at(-1), {
		actor: "1",
		action: "web.configuration.secret_replaced",
		data: { key: "coingecko.api_key" },
	});
});

test("secure replacement rejects unknown, empty and oversized values", async () => {
	const { service } = serviceHarness();
	const common = {
		currentPassword: "correct-password",
		authenticated: { user: { id: 1 } },
	};
	await assert.rejects(
		() => service.replaceSecret({ ...common, key: "unknown.secret", value: "x" }, { id: 1 }),
		/Unknown secure setting/,
	);
	await assert.rejects(
		() => service.replaceSecret({ ...common, key: "telegram.bot_token", value: "" }, { id: 1 }),
		/Secret value is required/,
	);
	await assert.rejects(
		() =>
			service.replaceSecret(
				{ ...common, key: "telegram.bot_token", value: "x".repeat(4097) },
				{ id: 1 },
			),
		/Secret value is too long/,
	);
});

function controllerHarness({ authenticated = true } = {}) {
	const calls = {
		auth: [],
		update: [],
		replace: [],
	};
	const snapshot = {
		runtime: { version: 3, entries: [] },
		secure: { version: 1, entries: [] },
		protected: { app_master_key_configured: true },
	};
	const services = {
		webAuth: {
			async routingState() {
				return { adminPath: "secret-panel" };
			},
			async authenticate(_request, options) {
				calls.auth.push(options);
				return authenticated
					? {
							user: { id: 1, must_complete_bootstrap: 0 },
							tokenHash: "session",
						}
					: null;
			},
		},
		configurationManagement: {
			snapshot() {
				return snapshot;
			},
			async updateRuntime(values) {
				calls.update.push(values);
				return snapshot;
			},
			async replaceSecret(input) {
				calls.replace.push(input);
				return {
					key: input.key,
					configured: true,
					source: "encrypted_d1",
					write_only: true,
				};
			},
		},
	};
	return {
		controller: new WebAdminConfigurationController(services),
		calls,
	};
}

test("configuration Web API GET is authenticated and CSRF-free", async () => {
	const { controller, calls } = controllerHarness();
	const request = new Request("https://example.test/secret-panel/api/v1/configuration");
	const response = await controller.route(request, new URL(request.url));
	assert.equal(response.status, 200);
	assert.deepEqual(calls.auth, [{ requireCsrf: false }]);
	const body = await response.json();
	assert.equal(body.success, true);
	assert.equal(body.data.runtime.version, 3);
});

test("configuration Web API mutations require CSRF and route runtime updates", async () => {
	const { controller, calls } = controllerHarness();
	const request = new Request(
		"https://example.test/secret-panel/api/v1/configuration/runtime",
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				values: { "general.timezone": "Asia/Tehran" },
			}),
		},
	);
	const response = await controller.route(request, new URL(request.url));
	assert.equal(response.status, 200);
	assert.deepEqual(calls.auth, [{ requireCsrf: true }]);
	assert.deepEqual(calls.update, [
		{ "general.timezone": "Asia/Tehran" },
	]);
});

test("secure Web API mutation passes secret only to write path and returns status only", async () => {
	const { controller, calls } = controllerHarness();
	const request = new Request(
		"https://example.test/secret-panel/api/v1/configuration/secrets/coingecko.api_key",
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				value: "private-cg-value",
				current_password: "private-password",
			}),
		},
	);
	const response = await controller.route(request, new URL(request.url));
	assert.equal(response.status, 200);
	assert.equal(calls.replace.length, 1);
	assert.equal(calls.replace[0].key, "coingecko.api_key");
	const payloadText = await response.text();
	assert.doesNotMatch(payloadText, /private-cg-value|private-password/);
	assert.match(payloadText, /encrypted_d1/);
});

test("configuration Web API rejects unauthenticated requests before management service access", async () => {
	const { controller, calls } = controllerHarness({ authenticated: false });
	const request = new Request("https://example.test/secret-panel/api/v1/configuration");
	const response = await controller.route(request, new URL(request.url));
	assert.equal(response.status, 401);
	assert.equal(calls.update.length, 0);
	assert.equal(calls.replace.length, 0);
});

test("configuration Web API rejects malformed and oversized JSON bodies", async () => {
	{
		const { controller } = controllerHarness();
		const request = new Request(
			"https://example.test/secret-panel/api/v1/configuration/runtime",
			{ method: "PATCH", body: "{" },
		);
		const response = await controller.route(request, new URL(request.url));
		assert.equal(response.status, 400);
		const payload = await response.json();
		assert.equal(payload.code, "invalid_json");
	}
	{
		const { controller } = controllerHarness();
		const request = new Request(
			"https://example.test/secret-panel/api/v1/configuration/runtime",
			{
				method: "PATCH",
				body: JSON.stringify({ values: { x: "x".repeat(20_000) } }),
			},
		);
		const response = await controller.route(request, new URL(request.url));
		assert.equal(response.status, 413);
		const payload = await response.json();
		assert.equal(payload.code, "body_too_large");
	}
});

test("WebAuthService exposes explicit current-password confirmation for sensitive configuration writes", async () => {
	const source = await readFile(
		new URL("../src/services/web-auth.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /async confirmPassword\(authenticated, passwordInput\)/);
	assert.match(source, /password_confirmation_failed/);
	assert.match(source, /this\.passwordHasher\.verify/);
});

test("application and composition root wire a dedicated configuration-management boundary", async () => {
	const [application, container] = await Promise.all([
		readFile(new URL("../src/app/application.js", import.meta.url), "utf8"),
		readFile(new URL("../src/app/container.js", import.meta.url), "utf8"),
	]);
	assert.match(application, /WebAdminConfigurationController/);
	assert.match(application, /this\.webAdminConfiguration\.route\(request, url\)/);
	assert.match(container, /ConfigurationManagementService/);
	assert.match(container, /configurationManagement,/);
});

test("Admin UI allow-list contains configuration assets and keeps them private", async () => {
	const source = await readFile(
		new URL("../src/controllers/web-admin-ui.controller.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /assets\/configuration\.css/);
	assert.match(source, /assets\/configuration\.js/);
});

test("Admin API client exposes configuration snapshot runtime update and secret replacement", async () => {
	const source = await readFile(
		new URL("../public/admin/assets/api.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /configuration\(\)/);
	assert.match(source, /updateRuntimeConfiguration\(values, csrfToken\)/);
	assert.match(source, /replaceSecureConfiguration\(key, value, currentPassword, csrfToken\)/);
	assert.match(source, /current_password/);
});

test("settings view is a real full configuration surface with dedicated module", async () => {
	const [html, app, configuration] = await Promise.all([
		readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
		readFile(new URL("../public/admin/assets/configuration.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /id="configuration-panel"/);
	assert.match(html, /id="configuration-runtime-groups"/);
	assert.match(html, /id="configuration-secure-list"/);
	assert.match(html, /assets\/configuration\.css/);
	assert.match(app, /import \{ configurationView \} from "\.\/configuration\.js";/);
	assert.match(app, /await configurationView\.load\(\)/);
	assert.match(configuration, /updateRuntimeConfiguration/);
	assert.match(configuration, /replaceSecureConfiguration/);
	assert.match(configuration, /testConfiguredSource/);
});

test("configuration UI never uses innerHTML and secret inputs are write-only password fields", async () => {
	const source = await readFile(
		new URL("../public/admin/assets/configuration.js", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /\.innerHTML\s*=/);
	assert.match(source, /secret\.type = "password"/);
	assert.match(source, /secret\.autocomplete = "new-password"/);
	assert.match(source, /password\.autocomplete = "current-password"/);
	assert.doesNotMatch(source, /entry\.value.*secure|secure.*entry\.value/i);
});

test("configuration UI can test each provider URL and CoinGecko without hardcoded secret values", async () => {
	const source = await readFile(
		new URL("../public/admin/assets/configuration.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /providerSourceFromKey/);
	assert.match(source, /testConfiguredSource\(sourceName\)/);
	assert.match(source, /testConfiguredSource\("coingecko"\)/);
	assert.doesNotMatch(source, /COINGECKO_API_KEY\s*=/);
});

test("Phase 19.8 command aggregates both A and B regression suites", async () => {
	const pkg = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	);
	assert.match(pkg.scripts["test:phase19.8"], /phase19\.8\.test\.js/);
	assert.match(pkg.scripts["test:phase19.8"], /phase19\.8b\.test\.js/);
});
