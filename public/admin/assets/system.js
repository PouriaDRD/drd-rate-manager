const copy = Object.freeze({
  fa: {
    title: "وضعیت سیستم",
    intro: "نمای تجمیعی سلامت Worker، دیتابیس، کش، اتوماسیون و منابع؛ بدون فراخوانی مستقیم Providerها.",
    refresh: "بروزرسانی وضعیت",
    generated: "آخرین بررسی",
    overallHealth: "سلامت کلی",
    healthy: "سالم",
    degraded: "نیازمند توجه",
    critical: "بحرانی",
    disabled: "غیرفعال",
    runtime: "Runtime",
    database: "دیتابیس",
    cache: "کش بازار",
    automation: "اتوماسیون",
    sources: "منابع",
    admins: "ادمین‌ها",
    settings: "وضعیت تنظیمات",
    version: "نسخه",
    schema: "Schema",
    timezone: "Timezone",
    integrity: "Runtime integrity",
    bot: "ربات",
    connected: "متصل",
    disconnected: "قطع",
    enabled: "فعال",
    disabledValue: "غیرفعال",
    ok: "OK",
    failed: "ناموفق",
    provider: "Provider",
    latency: "Latency",
    storage: "فضای D1",
    used: "مصرف‌شده",
    remaining: "باقی‌مانده",
    records: "رکوردهای دیتابیس",
    cacheFresh: "تازه",
    cacheExpired: "منقضی",
    cacheEmpty: "خالی",
    cacheAge: "سن کش",
    ttlRemaining: "TTL باقی‌مانده",
    lastError: "آخرین خطا",
    currentReason: "وضعیت فعلی",
    nextPublish: "انتشار بعدی",
    lastSuccess: "آخرین موفقیت",
    canPublish: "قابل انتشار اکنون",
    yes: "بله",
    no: "خیر",
    enabledSources: "منابع فعال",
    healthySources: "سالم",
    failedSources: "ناموفق",
    uncheckedSources: "بررسی‌نشده",
    usdtPriority: "اولویت USDT",
    sourceDetails: "جزئیات منابع",
    neverChecked: "هنوز بررسی نشده",
    activeAdmins: "ادمین فعال",
    inactiveAdmins: "ادمین غیرفعال",
    ownerConfigured: "مالک تنظیم شده",
    runtimeSettings: "Runtime settings",
    secureSettings: "Secure settings",
    migrated: "مهاجرت کامل",
    notMigrated: "مهاجرت ناقص",
    d1Coverage: "پوشش D1",
    encryptedCoverage: "پوشش رمزنگاری‌شده",
    masterKey: "APP_MASTER_KEY",
    configured: "تنظیم شده",
    missing: "وجود ندارد",
    reasons: "دلایل وضعیت",
    noReasons: "موردی برای گزارش وجود ندارد.",
    status_database_unavailable: "اتصال دیتابیس در دسترس نیست",
    status_runtime_integrity_failed: "Runtime integrity ناموفق است",
    status_runtime_settings_invalid: "Runtime setting نامعتبر در D1 وجود دارد",
    status_no_sources_enabled: "هیچ منبعی فعال نیست",
    status_source_failures: "یک یا چند منبع ناموفق هستند",
    status_sources_unverified: "برخی منابع هنوز بررسی نشده‌اند",
    status_cache_empty: "کش بازار خالی است",
    status_cache_expired: "کش بازار منقضی شده",
    status_cache_last_error: "کش آخرین خطا دارد",
    status_bot_disabled: "ربات غیرفعال است",
    status_runtime_settings_legacy_fallback: "برخی تنظیمات هنوز از ENV خوانده می‌شوند",
    status_runtime_settings_default_fallback: "برخی تنظیمات از مقدار پیش‌فرض استفاده می‌کنند",
    runtimeInvalid: "کلیدهای نامعتبر D1",
    legacyFallback: "Fallback به ENV",
    defaultFallback: "Fallback به default",
    secureLegacy: "Secure fallback به ENV",
    secureMissing: "Secretهای تنظیم‌نشده",
    seconds: "ثانیه",
    tables: "جدول",
  },
  en: {
    title: "System status",
    intro: "Aggregated Worker, database, cache, automation and source health without triggering provider refreshes.",
    refresh: "Refresh status",
    generated: "Last checked",
    overallHealth: "Overall health",
    healthy: "Healthy",
    degraded: "Needs attention",
    critical: "Critical",
    disabled: "Disabled",
    runtime: "Runtime",
    database: "Database",
    cache: "Market cache",
    automation: "Automation",
    sources: "Sources",
    admins: "Admins",
    settings: "Settings status",
    version: "Version",
    schema: "Schema",
    timezone: "Timezone",
    integrity: "Runtime integrity",
    bot: "Bot",
    connected: "Connected",
    disconnected: "Disconnected",
    enabled: "Enabled",
    disabledValue: "Disabled",
    ok: "OK",
    failed: "Failed",
    provider: "Provider",
    latency: "Latency",
    storage: "D1 storage",
    used: "Used",
    remaining: "Remaining",
    records: "Database records",
    cacheFresh: "Fresh",
    cacheExpired: "Expired",
    cacheEmpty: "Empty",
    cacheAge: "Cache age",
    ttlRemaining: "TTL remaining",
    lastError: "Last error",
    currentReason: "Current reason",
    nextPublish: "Next publish",
    lastSuccess: "Last success",
    canPublish: "Can publish now",
    yes: "Yes",
    no: "No",
    enabledSources: "Enabled sources",
    healthySources: "Healthy",
    failedSources: "Failed",
    uncheckedSources: "Unchecked",
    usdtPriority: "USDT priority",
    sourceDetails: "Source details",
    neverChecked: "Never checked",
    activeAdmins: "Active admins",
    inactiveAdmins: "Inactive admins",
    ownerConfigured: "Owner configured",
    runtimeSettings: "Runtime settings",
    secureSettings: "Secure settings",
    migrated: "Fully migrated",
    notMigrated: "Migration incomplete",
    d1Coverage: "D1 coverage",
    encryptedCoverage: "Encrypted coverage",
    masterKey: "APP_MASTER_KEY",
    configured: "Configured",
    missing: "Missing",
    reasons: "Health reasons",
    noReasons: "Nothing to report.",
    status_database_unavailable: "Database connection is unavailable",
    status_runtime_integrity_failed: "Runtime integrity failed",
    status_runtime_settings_invalid: "Invalid D1 runtime setting exists",
    status_no_sources_enabled: "No sources are enabled",
    status_source_failures: "One or more enabled sources are failing",
    status_sources_unverified: "Some enabled sources have not been checked",
    status_cache_empty: "Market cache is empty",
    status_cache_expired: "Market cache has expired",
    status_cache_last_error: "Market cache reports a last error",
    status_bot_disabled: "Bot is disabled",
    status_runtime_settings_legacy_fallback: "Some runtime settings still use ENV fallback",
    status_runtime_settings_default_fallback: "Some runtime settings use code defaults",
    runtimeInvalid: "Invalid D1 keys",
    legacyFallback: "ENV fallback",
    defaultFallback: "Default fallback",
    secureLegacy: "Secure ENV fallback",
    secureMissing: "Missing secrets",
    seconds: "seconds",
    tables: "tables",
  },
});

const state = { data: null };

const root = document.querySelector("#system-view");
const refreshButton = document.querySelector("#system-reload");

refreshButton?.addEventListener("click", () => withBusy(refreshButton, load));

window.DRDSystem = Object.freeze({
  load,
  render,
  reset,
});

async function load() {
  const payload = await bridge().system();
  state.data = payload.data || null;
  render();
}

function reset() {
  state.data = null;
  clearDynamicLists();
}

function render() {
  if (!root || !state.data) return;
  applyCopy();
  const data = state.data;

  const health = String(data.health?.status || "critical");
  const healthLabel = tr(health);
  setText("system-health", healthLabel);
  setTone("system-health-card", health);
  setText("system-generated", formatDateTime(data.generated_at));

  setText("system-runtime-version", data.runtime?.version || "—");
  setText("system-runtime-schema", data.runtime?.schema_version ?? "—");
  setText("system-runtime-timezone", data.runtime?.timezone || "—");
  setText("system-runtime-integrity", data.runtime?.integrity ? tr("ok") : tr("failed"));
  setText("system-bot-status", data.runtime?.bot_enabled ? tr("enabled") : tr("disabledValue"));

  setText("system-db-status", data.database?.connected ? tr("connected") : tr("disconnected"));
  setText("system-db-provider", data.database?.provider || "—");
  setText("system-db-latency", formatMs(data.database?.latency_ms));
  renderStorage(data.database?.storage || {});
  renderRecords(data.database?.records || {});

  const cache = data.cache || {};
  const cacheStatus = !cache.present
    ? tr("cacheEmpty")
    : cache.expired
      ? tr("cacheExpired")
      : tr("cacheFresh");
  setText("system-cache-status", cacheStatus);
  setText("system-cache-age", formatSeconds(cache.age_seconds));
  setText("system-cache-ttl", formatSeconds(cache.ttl_remaining_seconds));
  setText("system-cache-error", cache.last_error || "—");

  const automation = data.automation || {};
  setText("system-automation-status", automation.enabled ? tr("enabled") : tr("disabledValue"));
  setText("system-automation-reason", humanCode(automation.reason));
  setText("system-automation-next", formatDateTime(automation.next_publish_at));
  setText("system-automation-last", formatDateTime(automation.last_success_at));
  setText("system-automation-can-publish", automation.can_publish_now ? tr("yes") : tr("no"));

  renderSources(data.sources || {});
  renderAdmins(data.admins || {});
  renderSettings(data.settings || {});
  renderReasons(data.health?.reason_codes || []);
}

function renderStorage(storage) {
  const available = Boolean(storage.available);
  const percent = clamp(Number(storage.percent || 0), 0, 100);
  const bar = document.querySelector("#system-storage-fill");
  if (bar) bar.style.width = `${available ? percent : 0}%`;
  setText("system-storage-percent", available ? `${percent.toFixed(2)}%` : "—");
  setText("system-storage-used", available ? formatMb(storage.used_mb) : "—");
  setText("system-storage-total", formatMb(storage.total_mb));
  setText("system-storage-remaining", available ? formatMb(storage.remaining_mb) : "—");
}

function renderRecords(records) {
  const target = document.querySelector("#system-records");
  if (!target) return;
  target.replaceChildren();
  for (const [name, value] of Object.entries(records)) {
    const row = node("div", "system-record-row");
    row.append(
      textNode("span", name, "system-code", "ltr"),
      textNode("strong", Number(value || 0).toLocaleString("en-US"), "", "ltr"),
    );
    target.append(row);
  }
  if (!Object.keys(records).length) {
    target.append(textNode("p", "—", "system-empty"));
  }
}

function renderSources(sources) {
  setText("system-sources-enabled", sources.enabled ?? 0);
  setText("system-sources-healthy", sources.healthy ?? 0);
  setText("system-sources-failed", sources.failed ?? 0);
  setText("system-sources-unchecked", sources.unchecked ?? 0);
  setText("system-usdt-priority", (sources.usdt_priority || []).join(" → ") || "—");

  const target = document.querySelector("#system-source-list");
  if (!target) return;
  target.replaceChildren();

  for (const item of sources.items || []) {
    const row = node("div", "system-source-row");
    const identity = node("div", "system-source-identity");
    const dot = node("span", `system-source-dot ${sourceTone(item)}`);
    const identityCopy = node("div");
    identityCopy.append(
      textNode("strong", item.label || item.name),
      textNode("span", `${item.kind || "—"} · ${item.enabled ? tr("enabled") : tr("disabledValue")}`, "system-muted"),
    );
    identity.append(dot, identityCopy);

    const details = node("div", "system-source-detail");
    details.append(
      textNode("span", item.checked ? `HTTP ${item.http_status ?? "—"}` : tr("neverChecked"), "system-code"),
      textNode("span", formatMs(item.latency_ms), "system-muted"),
      textNode("span", formatDateTime(item.last_checked_at), "system-muted"),
    );
    if (item.message) details.title = String(item.message);
    row.append(identity, details);
    target.append(row);
  }
}

function renderAdmins(admins) {
  setText("system-admin-total", admins.total ?? 0);
  setText("system-admin-active", admins.active_admins ?? 0);
  setText("system-admin-inactive", admins.inactive_admins ?? 0);
  setText("system-owner-configured", admins.owner_configured ? tr("yes") : tr("no"));
}

function renderSettings(settings) {
  const runtime = settings.runtime || {};
  const secure = settings.secure || {};

  setText(
    "system-runtime-migration",
    runtime.fully_migrated ? tr("migrated") : tr("notMigrated"),
  );
  setText("system-runtime-coverage", `${runtime.d1_count ?? 0} / ${runtime.total ?? 0}`);
  setText("system-runtime-invalid", joinValues(runtime.invalid_d1_keys));
  setText("system-runtime-legacy", joinValues(runtime.legacy_fallback_keys));
  setText("system-runtime-default", joinValues(runtime.default_fallback_keys));

  setText(
    "system-secure-migration",
    secure.fully_migrated ? tr("migrated") : tr("notMigrated"),
  );
  setText(
    "system-secure-coverage",
    `${secure.encrypted_count ?? 0} / ${secure.managed_count ?? 0}`,
  );
  setText(
    "system-master-key",
    secure.master_key_configured ? tr("configured") : tr("missing"),
  );
  setText("system-secure-legacy", secure.legacy_fallback_count ?? 0);
  setText("system-secure-missing", secure.missing_count ?? 0);
}

function renderReasons(reasons) {
  const target = document.querySelector("#system-reasons");
  if (!target) return;
  target.replaceChildren();

  if (!reasons.length) {
    target.append(textNode("p", tr("noReasons"), "system-empty"));
    return;
  }

  for (const reason of reasons) {
    const item = node("div", "system-reason-row");
    item.append(
      textNode("span", reasonIcon(reason), "system-reason-icon"),
      textNode("span", tr(`status_${reason}`), ""),
      textNode("code", reason, "system-code", "ltr"),
    );
    target.append(item);
  }
}

function applyCopy() {
  root.querySelectorAll("[data-system-i18n]").forEach((element) => {
    element.textContent = tr(element.dataset.systemI18n);
  });
}

function clearDynamicLists() {
  for (const id of ["system-records", "system-source-list", "system-reasons"]) {
    document.querySelector(`#${id}`)?.replaceChildren();
  }
}

function setTone(id, tone) {
  const element = document.querySelector(`#${id}`);
  if (!element) return;
  element.dataset.health = tone;
}

function sourceTone(item) {
  if (!item.enabled) return "disabled";
  if (!item.checked) return "unchecked";
  return item.healthy ? "healthy" : "failed";
}

function reasonIcon(reason) {
  if (["database_unavailable", "runtime_integrity_failed", "runtime_settings_invalid"].includes(reason)) return "●";
  if (["source_failures", "sources_unverified", "cache_empty", "cache_expired", "cache_last_error", "no_sources_enabled"].includes(reason)) return "▲";
  return "•";
}

function humanCode(value) {
  if (!value) return "—";
  return String(value).replaceAll("_", " ");
}

function joinValues(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "—";
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language() === "fa" ? "fa-IR" : "en-GB", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function formatSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.max(0, number)} ${tr("seconds")}` : "—";
}

function formatMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number} ms` : "—";
}

function formatMb(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)} MB` : "—";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function bridge() {
  if (!window.DRDAdminShell) throw new Error("Admin shell bridge is not available.");
  return window.DRDAdminShell;
}

function language() {
  return bridge().language() === "en" ? "en" : "fa";
}

function tr(key) {
  return copy[language()]?.[key] || copy.en[key] || key;
}

async function withBusy(control, operation) {
  if (control) {
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
  }
  try {
    return await operation();
  } catch (error) {
    bridge().toast(error?.message || "Request failed.", "error");
    return null;
  } finally {
    if (control) {
      control.disabled = false;
      control.setAttribute("aria-busy", "false");
    }
  }
}

function setText(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) element.textContent = String(value ?? "—");
}

function node(tag, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function textNode(tag, value, className = "", dir = "") {
  const element = node(tag, className);
  element.textContent = String(value ?? "");
  if (dir) element.dir = dir;
  return element;
}
