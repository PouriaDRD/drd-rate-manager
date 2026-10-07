import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Admins is a real Web Admin view rather than a placeholder", async () => {
  const html = await readFile(new URL("../public/admin/index.html", import.meta.url), "utf8");
  assert.match(html, /id="admins-view"/);
  assert.match(html, /id="admin-add-form"/);
  assert.match(html, /id="admins-list"/);
  assert.match(html, /id="admins-reload"/);
});

test("Admin API client covers the Phase 10.1 endpoints with CSRF mutations", async () => {
  const api = await readFile(new URL("../public/admin/assets/api.js", import.meta.url), "utf8");
  assert.match(api, /admins\(\).*api\/v1\/admins/s);
  assert.match(api, /addAdmin\(userId, csrfToken\)/);
  assert.match(api, /updateAdmin\(id, enabled, csrfToken\)/);
  assert.match(api, /removeAdmin\(id, csrfToken\)/);
  assert.match(api, /method: "DELETE", csrfToken/);
});

test("app shell exposes a narrow runtime bridge instead of browser-stored CSRF", async () => {
  const app = await readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8");
  assert.match(app, /window\.DRDAdminShell = Object\.freeze/);
  assert.match(app, /api\.addAdmin\(userId, state\.csrfToken\)/);
  assert.match(app, /api\.updateAdmin\(id, enabled, state\.csrfToken\)/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*csrf/i);
});

test("Admins participates in normal view activation and language rerendering", async () => {
  const app = await readFile(new URL("../public/admin/assets/app.js", import.meta.url), "utf8");
  assert.match(app, /const VIEW_ELEMENT_IDS = Object\.freeze/);
  assert.match(app, /admins:\s*"admins-view"/);
  assert.match(app, /Object\.entries\(VIEW_ELEMENT_IDS\)/);
  assert.match(app, /window\.DRDAdmins\?\.load\?\.\(\)/);
  assert.match(app, /window\.DRDAdmins\?\.render\?\.\(\)/);
});

test("admin component renders untrusted data through textContent-safe DOM nodes", async () => {
  const source = await readFile(new URL("../public/admin/assets/admins.js", import.meta.url), "utf8");
  assert.match(source, /document\.createElement/);
  assert.match(source, /element\.textContent =/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
});

test("owner is rendered as immutable and destructive controls are omitted", async () => {
  const source = await readFile(new URL("../public/admin/assets/admins.js", import.meta.url), "utf8");
  assert.match(source, /if \(admin\.immutable\)/);
  assert.match(source, /ownerHint/);
  assert.match(source, /else if \(state\.data\?\.capabilities\?\.can_manage\)/);
});

test("disable and remove actions require explicit confirmation", async () => {
  const source = await readFile(new URL("../public/admin/assets/admins.js", import.meta.url), "utf8");
  assert.match(source, /disableConfirm/);
  assert.match(source, /removeConfirm/);
  assert.match(source, /confirm\(tr\("disableConfirm"\)\)/);
  assert.match(source, /confirm\(tr\("removeConfirm"\)\)/);
});

test("admin form normalizes Persian and Arabic digits before sending", async () => {
  const source = await readFile(new URL("../public/admin/assets/admins.js", import.meta.url), "utf8");
  assert.match(source, /normalizeDigits/);
  assert.match(source, /\[۰-۹\]/);
  assert.match(source, /\[٠-٩\]/);
  assert.match(source, /\/\^\\d\{5,20\}\$\//);
});

test("admin UI copy is self-contained in Persian and English", async () => {
  const source = await readFile(new URL("../public/admin/assets/admins.js", import.meta.url), "utf8");
  assert.match(source, /مدیریت ادمین‌ها/);
  assert.match(source, /Admin management/);
  assert.match(source, /Administrator removed/);
  assert.match(source, /ادمین حذف شد/);
});

test("Admin management layout is responsive and theme-token based", async () => {
  const css = await readFile(new URL("../public/admin/assets/admins.css", import.meta.url), "utf8");
  assert.match(css, /var\(--panel\)/);
  assert.match(css, /var\(--accent\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
