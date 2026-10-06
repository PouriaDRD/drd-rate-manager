import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("System is a real Web Admin view rather than a placeholder", async () => {
  const html = await readFile(new URL("../public/admin/index.html", import.meta.url), "utf8");
  assert.match(html, /id="system-view"/);
  assert.match(html, /id="system-health"/);
  assert.match(html, /id="system-source-list"/);
  assert.match(html, /id="system-records"/);
  assert.match(html, /id="system-reasons"/);
});

test("Admin API client exposes the read-only Phase 11.1 system endpoint", async () => {
  const api = await readFile(new URL("../public/admin/assets/api.js", import.meta.url), "utf8");
  assert.match(api, /system\(\) \{ return this\.#request\("\/api\/v1\/system"\); \}/);
});

test("app shell exposes System through the existing narrow runtime bridge", async () => {
  const app = await readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8");
  assert.match(app, /system: \(\) => api\.system\(\)/);
  assert.match(app, /"automation", "admins", "apiManagement", "loginHistory", "system", "settings"/);
  assert.match(app, /window\.DRDSystem\?\.load\?\.\(\)/);
});

test("System rerenders when persisted panel language changes", async () => {
  const app = await readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8");
  assert.match(app, /state\.activeView === "system".*DRDSystem\?\.render/s);
});

test("System diagnostics render API data with safe DOM primitives", async () => {
  const source = await readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8");
  assert.match(source, /document\.createElement/);
  assert.match(source, /element\.textContent =/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
});

test("System UI covers runtime, database, cache, automation, sources, admins and settings", async () => {
  const source = await readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8");
  for (const token of [
    "data.runtime",
    "data.database",
    "data.cache",
    "data.automation",
    "renderSources",
    "renderAdmins",
    "renderSettings",
    "renderReasons",
  ]) {
    assert.ok(source.includes(token), token);
  }
});

test("System refresh uses only the aggregate system endpoint", async () => {
  const source = await readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8");
  assert.match(source, /bridge\(\)\.system\(\)/);
  assert.doesNotMatch(source, /refreshMarket/);
  assert.doesNotMatch(source, /testSource/);
  assert.doesNotMatch(source, /fetchTopAssets/);
});

test("health reason codes have localized FA and EN presentation", async () => {
  const source = await readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8");
  assert.match(source, /status_database_unavailable/);
  assert.match(source, /اتصال دیتابیس در دسترس نیست/);
  assert.match(source, /Database connection is unavailable/);
  assert.match(source, /status_runtime_settings_default_fallback/);
});

test("D1 storage display is bounded and uses no unsafe style injection", async () => {
  const source = await readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8");
  assert.match(source, /clamp\(Number\(storage\.percent/);
  assert.match(source, /bar\.style\.width = `\$\{available \? percent : 0\}%`/);
  assert.doesNotMatch(source, /style\.cssText/);
});

test("System layout is responsive, theme-token based and reduced-motion aware", async () => {
  const css = await readFile(new URL("../public/admin/assets/system.css", import.meta.url), "utf8");
  assert.match(css, /var\(--panel\)/);
  assert.match(css, /var\(--success\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("System UI never displays secret values, only secure-setting status fields", async () => {
  const source = await readFile(new URL("../public/admin/assets/system.js", import.meta.url), "utf8");
  assert.match(source, /master_key_configured/);
  assert.match(source, /encrypted_count/);
  assert.match(source, /missing_count/);
  assert.doesNotMatch(source, /telegram\.bot_token/);
  assert.doesNotMatch(source, /api_token.*value/i);
});

test("Phase 10 Admins assets remain present after System UI integration", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../public/admin/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /assets\/admins\.css/);
  assert.match(html, /assets\/admins\.js/);
  assert.match(app, /window\.DRDAdmins/);
});
