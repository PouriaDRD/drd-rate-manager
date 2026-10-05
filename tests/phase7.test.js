import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PreferencesService } from "../src/services/preferences.service.js";
import { normalizeTelegramLanguage, telegramT } from "../src/telegram/i18n.js";

class FakeSettings {
	constructor(values = {}) {
		this.values = { ...values };
		this.saved = [];
	}
	async getMany(keys) {
		return Object.fromEntries(keys.filter((key) => key in this.values).map((key) => [key, this.values[key]]));
	}
	async setMany(values) {
		this.saved.push({ ...values });
		Object.assign(this.values, values);
	}
}

test("preferences default safely and persist validated D1 values", async () => {
	const settings = new FakeSettings();
	const service = new PreferencesService(settings);
	assert.deepEqual(await service.refresh(), {
		admin_ui_language: "fa",
		admin_ui_theme: "system",
		telegram_language: "fa",
	});
	assert.deepEqual(await service.update({
		admin_ui_language: "en",
		admin_ui_theme: "dark",
		telegram_language: "en",
	}), {
		admin_ui_language: "en",
		admin_ui_theme: "dark",
		telegram_language: "en",
	});
	assert.deepEqual(settings.saved.at(-1), {
		admin_ui_language: "en",
		admin_ui_theme: "dark",
		telegram_language: "en",
	});
});

test("invalid preference values collapse to safe defaults before storage", async () => {
	const settings = new FakeSettings();
	const service = new PreferencesService(settings);
	await service.update({ admin_ui_language: "xx", admin_ui_theme: "neon", telegram_language: "de" });
	assert.deepEqual(service.snapshot(), {
		admin_ui_language: "fa",
		admin_ui_theme: "system",
		telegram_language: "fa",
	});
});

test("Telegram admin language has deterministic FA and EN copy", () => {
	assert.equal(normalizeTelegramLanguage("en"), "en");
	assert.equal(normalizeTelegramLanguage("xx"), "fa");
	assert.equal(telegramT("fa", "settings"), "تنظیمات");
	assert.equal(telegramT("en", "settings"), "Settings");
	assert.equal(telegramT("en", "languageName"), "English");
});

test("admin API exposes dashboard, market actions and D1 preferences", async () => {
	const source = await readFile(new URL("../src/controllers/web-admin-data.controller.js", import.meta.url), "utf8");
	assert.match(source, /api\/v1\/dashboard/);
	assert.match(source, /api\/v1\/market\/refresh/);
	assert.match(source, /api\/v1\/market\/preview/);
	assert.match(source, /api\/v1\/market\/publish/);
	assert.match(source, /api\/v1\/preferences/);
	assert.match(source, /requireCsrf: mutation/);
	assert.match(source, /text|rich/);
});

test("frontend restores D1 preferences after authentication and persists toggles", async () => {
	const app = await readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8");
	const api = await readFile(new URL("../public/admin/assets/api.js", import.meta.url), "utf8");
	assert.match(app, /hydratePreferences/);
	assert.match(app, /admin_ui_language/);
	assert.match(app, /admin_ui_theme/);
	assert.match(app, /telegram_language/);
	assert.match(api, /updatePreferences/);
	assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*(csrf|token|session)/i);
});

test("dashboard and market shells are now real data surfaces", async () => {
	const html = await readFile(new URL("../public/admin/index.html", import.meta.url), "utf8");
	assert.match(html, /id="dashboard-usdt"/);
	assert.match(html, /id="dashboard-next-publish"/);
	assert.match(html, /id="market-refresh"/);
	assert.match(html, /id="market-preview"/);
	assert.match(html, /id="market-publish"/);
	assert.match(html, /id="preferences-form"/);
	assert.match(html, /id="telegram-language-select"/);
});

test("preview content is rendered as text rather than injected HTML", async () => {
	const app = await readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8");
	assert.match(app, /previewContent\.textContent/);
	assert.doesNotMatch(app, /previewContent\.innerHTML/);
});

test("Telegram webhook refreshes persisted language and exposes a language toggle", async () => {
	const core = await readFile(new URL("../src/controllers/telegram/telegram-core.methods.js", import.meta.url), "utf8");
	const settings = await readFile(new URL("../src/controllers/telegram/telegram-settings.methods.js", import.meta.url), "utf8");
	assert.match(core, /preferences\?\.refresh/);
	assert.match(core, /settings:language:toggle/);
	assert.match(core, /toggleTelegramLanguage/);
	assert.match(settings, /languageName/);
});

test("format configuration prevents line ending churn and supports changed-file formatting", async () => {
	const editor = await readFile(new URL("../.editorconfig", import.meta.url), "utf8");
	const attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");
	const prettier = JSON.parse(await readFile(new URL("../.prettierrc.json", import.meta.url), "utf8"));
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	const vscode = JSON.parse(await readFile(new URL("../.vscode/settings.json", import.meta.url), "utf8"));
	assert.match(editor, /end_of_line = lf/);
	assert.match(attributes, /\* text=auto eol=lf/);
	assert.equal(prettier.endOfLine, "lf");
	assert.equal(prettier.useTabs, true);
	assert.match(pkg.scripts["format:changed"], /format-changed/);
	assert.match(pkg.scripts["format:check"], /check-format-stability/);
	assert.equal(vscode["editor.formatOnSave"], false);
	assert.equal(pkg.devDependencies.prettier, "3.9.9");
});
