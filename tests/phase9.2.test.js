import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("automation view is a real Phase 9.2 management surface", async () => {
  const html = await read("../public/admin/index.html");
  for (const id of [
    "automation-view",
    "automation-form",
    "automation-enabled",
    "automation-interval",
    "automation-quiet-enabled",
    "automation-quiet-start",
    "automation-quiet-end",
    "automation-dry-run",
    "automation-force-run",
    "automation-history",
    "automation-countdown",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Phase 9\.2/);
});

test("admin API client covers every Phase 9.1 automation endpoint", async () => {
  const source = await read("../public/admin/assets/api.js");
  assert.match(source, /automation\(\)/);
  assert.match(source, /automation\/settings/);
  assert.match(source, /automation\/dry-run/);
  assert.match(source, /automation\/force-run/);
  assert.match(source, /automation\/history\?limit=/);
  assert.match(source, /credentials: "same-origin"/);
});

test("automation UI loads state, validates through backend and saves via CSRF", async () => {
  const source = await read("../public/admin/assets/app.js");
  assert.match(source, /async function loadAutomation/);
  assert.match(source, /updateAutomationSettings/);
  assert.match(source, /state\.csrfToken/);
  assert.match(source, /automation-quiet-start/);
  assert.match(source, /automation-quiet-end/);
});

test("dry run remains non-publishing and preview is rendered safely", async () => {
  const source = await read("../public/admin/assets/app.js");
  assert.match(source, /automationDryRun/);
  assert.match(source, /showPreview/);
  assert.match(source, /previewContent\.textContent/);
  assert.doesNotMatch(source, /previewContent\.innerHTML/);
});

test("force run has explicit confirmation before bypassing scheduler", async () => {
  const source = await read("../public/admin/assets/app.js");
  assert.match(source, /confirm\(t\(state\.language, "forceRunConfirm"\)\)/);
  assert.match(source, /automationForceRun/);
  assert.match(source, /refresh_market/);
});

test("countdown updates locally every second without polling backend", async () => {
  const source = await read("../public/admin/assets/app.js");
  assert.match(source, /startAutomationCountdown/);
  assert.match(source, /setInterval\(render, 1000\)/);
  assert.doesNotMatch(source, /setInterval\(.*api\.automation/s);
});

test("execution history is rendered with safe DOM nodes", async () => {
  const source = await read("../public/admin/assets/app.js");
  assert.match(source, /renderAutomationHistory/);
  assert.match(source, /replaceChildren/);
  assert.doesNotMatch(source, /automationHistory\.innerHTML/);
});

test("automation copy is available in both Persian and English", async () => {
  const source = await read("../public/admin/assets/i18n.js");
  assert.match(source, /automationControl: "کنترل انتشار خودکار"/);
  assert.match(source, /automationControl: "Automation control"/);
  assert.match(source, /reason_retry_pending/);
  assert.match(source, /forceRunConfirm/);
});

test("automation layout is responsive and respects reduced motion", async () => {
  const css = await read("../public/admin/assets/styles.css");
  assert.match(css, /\.automation-grid/);
  assert.match(css, /\.history-row/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Phase 6-8 core frontend surfaces remain present after the automation UI upgrade", async () => {
  const html = await read("../public/admin/index.html");
  for (const id of [
    "login-form",
    "bootstrap-form",
    "app-shell",
    "dashboard-usdt",
    "market-refresh",
    "preferences-form",
    "sources-list",
    "usdt-priority-list",
    "assets-list",
    "asset-search",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /<style[\s>]/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
});
