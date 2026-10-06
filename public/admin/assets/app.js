import { AdminApi, ApiError } from "./api.js";
import { applyLanguage, normalizeLanguage, t } from "./i18n.js";
import { apiManagementView } from "./api-management.js";
import { loginHistoryView } from "./login-history.js";

const THEME_KEY = "drd-admin-theme";
const LANG_KEY = "drd-admin-lang";
const VIEW_KEY = "drd-admin-view";
const THEME_ORDER = ["system", "dark", "light"];
const VIEWS = Object.freeze({
  dashboard: { index: "01", description: "dashboardIntro" },
  market: { index: "02", description: "viewMarket" },
  sources: { index: "03", description: "viewSources" },
  assets: { index: "04", description: "viewAssets" },
  automation: { index: "05", description: "viewAutomation" },
  admins: { index: "06", description: "viewAdmins" },
  apiManagement: { index: "07", description: "viewApiManagement" },
  loginHistory: { index: "08", description: "viewLoginHistory" },
  system: { index: "09", description: "viewSystem" },
  settings: { index: "10", description: "viewSettings" },
});

const storedActiveView = readPreference(VIEW_KEY, "dashboard");
const initialActiveView = VIEWS[storedActiveView] ? storedActiveView : "dashboard";

const state = {
  csrfToken: "",
  user: null,
  language: normalizeLanguage(readPreference(LANG_KEY, "fa")),
  theme: normalizeTheme(readPreference(THEME_KEY, "system")),
  telegramLanguage: "fa",
  activeView: initialActiveView,
  sourceData: null,
  assets: [],
  automationData: null,
  automationCountdownTimer: null,
};

const basePath = `/${location.pathname.split("/").filter(Boolean)[0] || "admin"}`;
const api = new AdminApi(basePath);
const media = matchMedia("(prefers-color-scheme: dark)");

window.DRDAdminShell = Object.freeze({
  language: () => state.language,
  system: () => api.system(),
  listAdmins: () => api.admins(),
  getAdmin: (id) => api.admin(id),
  addAdmin: (userId) => api.addAdmin(userId, state.csrfToken),
  setAdminEnabled: (id, enabled) => api.updateAdmin(id, enabled, state.csrfToken),
  removeAdmin: (id) => api.removeAdmin(id, state.csrfToken),
  apiManagementSnapshot: () => api.apiManagement(),
  createApiToken: (payload) => api.createApiToken(payload, state.csrfToken),
  setApiTokenEnabled: (id, enabled) => api.updateApiToken(id, enabled, state.csrfToken),
  rotateApiToken: (id, payload = {}) => api.rotateApiToken(id, payload, state.csrfToken),
  revokeApiToken: (id) => api.revokeApiToken(id, state.csrfToken),
  setMarketApiMode: (mode) => api.setMarketApiMode(mode, state.csrfToken),
  loginHistory: (options = {}) => api.loginHistory(options),
  toast: (message, type = "info") => showToast(message, type),
});

const els = Object.fromEntries([
  "boot-screen","boot-error","boot-retry","auth-screen","app-shell","login-form","bootstrap-form","login-error","bootstrap-error",
  "user-name","user-avatar","admin-route-value","page-title","page-eyebrow","dashboard-view",
  "market-view","sources-view","assets-view","automation-view","api-management-view","settings-view","placeholder-view",
  "placeholder-index","placeholder-title","placeholder-description","sidebar","sidebar-overlay","toast",
  "logout-button","preferences-form","admin-language-select","admin-theme-select","telegram-language-select",
  "preview-panel","preview-content","sources-list","usdt-priority-list","assets-list","asset-search",
  "asset-count","automation-form","automation-enabled","automation-interval","automation-quiet-enabled",
  "automation-quiet-start","automation-quiet-end","automation-refresh-market","automation-history",
].map((id) => [camel(id), document.querySelector(`#${id}`)]));

initialize();

async function initialize() {
  applyPreferences();
  bindEvents();
  await restoreSession();
}

function bindEvents() {
  document.querySelectorAll('[data-action="lang-toggle"]').forEach((button) => {
    button.addEventListener("click", toggleLanguage);
  });
  document.querySelectorAll('[data-action="theme-cycle"]').forEach((button) => {
    button.addEventListener("click", cycleTheme);
  });
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => togglePassword(button.dataset.togglePassword));
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.view));
  });

  document.querySelector("#sidebar-open")?.addEventListener("click", openSidebar);
  document.querySelector("#sidebar-close")?.addEventListener("click", closeSidebar);
  els.sidebarOverlay?.addEventListener("click", closeSidebar);
  els.loginForm?.addEventListener("submit", submitLogin);
  els.bootstrapForm?.addEventListener("submit", submitBootstrap);
  els.preferencesForm?.addEventListener("submit", savePreferencesForm);
  els.logoutButton?.addEventListener("click", submitLogout);
  els.bootRetry?.addEventListener("click", restoreSession);

  document.querySelector("#market-refresh")?.addEventListener("click", refreshMarket);
  document.querySelector("#market-preview")?.addEventListener("click", showMarketPreview);
  document.querySelector("#market-publish")?.addEventListener("click", publishMarket);
  document.querySelector("#sources-reload")?.addEventListener("click", (event) => runBusy(event.currentTarget, loadSources));
  document.querySelector("#assets-refresh")?.addEventListener("click", refreshAssets);
  els.assetSearch?.addEventListener("input", renderAssets);

  document.querySelector("#automation-reload")?.addEventListener("click", (event) => runBusy(event.currentTarget, loadAutomation));
  els.automationForm?.addEventListener("submit", saveAutomationSettings);
  document.querySelector("#automation-dry-run")?.addEventListener("click", automationDryRun);
  document.querySelector("#automation-force-run")?.addEventListener("click", automationForceRun);
  document.querySelector("#automation-history-refresh")?.addEventListener("click", refreshAutomationHistory);

  document.querySelector("#preview-close")?.addEventListener("click", () => {
    els.previewPanel.hidden = true;
  });
  media.addEventListener?.("change", () => {
    if (state.theme === "system") applyTheme();
  });
}

async function restoreSession() {
  showBoot();
  try {
    const payload = await api.session();
    state.user = payload.user;
    state.csrfToken = payload.csrf_token || "";
    if (payload.user?.mustCompleteBootstrap) return showBootstrap();
    await hydratePreferences();
    showApp();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      state.user = null;
      state.csrfToken = "";
      showLogin();
      return;
    }
    showBootError(error?.message || t(state.language, "sessionRestoreFailed"));
  }
}

async function hydratePreferences() {
  const payload = await api.preferences();
  applyServerPreferences(payload.data || {});
}

function applyServerPreferences(data) {
  state.language = normalizeLanguage(data.admin_ui_language);
  state.theme = normalizeTheme(data.admin_ui_theme);
  state.telegramLanguage = normalizeLanguage(data.telegram_language);
  writePreference(LANG_KEY, state.language);
  writePreference(THEME_KEY, state.theme);
  applyPreferences();
  syncPreferencesForm();
}

async function persistPreferences(values) {
  if (!state.csrfToken) return;
  const payload = await api.updatePreferences(values, state.csrfToken);
  applyServerPreferences(payload.data || {});
  showToast(t(state.language, "preferencesSaved"), "success");
}

async function submitLogin(event) {
  event.preventDefault();
  clearFormError(els.loginError);
  const submit = event.submitter;
  setBusy(submit, true);
  try {
    const payload = await api.login(
      document.querySelector("#login-username").value,
      document.querySelector("#login-password").value,
    );
    state.user = payload.user;
    state.csrfToken = payload.csrf_token || "";
    if (payload.bootstrap_required) showBootstrap();
    else {
      await hydratePreferences();
      showApp();
    }
  } catch (error) {
    showFormError(els.loginError, error.message || t(state.language, "loginFailed"));
  } finally {
    setBusy(submit, false);
  }
}

async function submitBootstrap(event) {
  event.preventDefault();
  clearFormError(els.bootstrapError);
  const submit = event.submitter;
  setBusy(submit, true);
  try {
    const payload = await api.bootstrap({
      username: document.querySelector("#bootstrap-username").value,
      password: document.querySelector("#bootstrap-password").value,
      admin_path: document.querySelector("#bootstrap-path").value,
    }, state.csrfToken);
    showToast(t(state.language, "bootstrapDone"), "success");
    location.replace(`${location.origin}${String(payload.admin_path || "").replace(/\/$/, "")}/`);
  } catch (error) {
    showFormError(els.bootstrapError, error.message || t(state.language, "bootstrapFailed"));
    setBusy(submit, false);
  }
}

async function submitLogout() {
  if (!state.csrfToken) return;
  setBusy(els.logoutButton, true);
  try {
    await api.logout(state.csrfToken);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      showToast(error.message || t(state.language, "networkError"), "error");
      setBusy(els.logoutButton, false);
      return;
    }
  }
  stopAutomationCountdown();
  apiManagementView.reset();
  loginHistoryView.reset();
  state.user = null;
  state.csrfToken = "";
  showLogin();
  showToast(t(state.language, "signedOut"), "success");
  setBusy(els.logoutButton, false);
}

async function savePreferencesForm(event) {
  event.preventDefault();
  const submit = event.submitter;
  setBusy(submit, true);
  try {
    await persistPreferences({
      admin_ui_language: els.adminLanguageSelect.value,
      admin_ui_theme: els.adminThemeSelect.value,
      telegram_language: els.telegramLanguageSelect.value,
    });
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
  } finally {
    setBusy(submit, false);
  }
}

function showBoot() {
  stopAutomationCountdown();
  els.bootScreen.hidden = false;
  els.bootScreen.setAttribute("aria-busy", "true");
  els.authScreen.hidden = true;
  els.appShell.hidden = true;
  if (els.bootError) {
    els.bootError.hidden = true;
    els.bootError.textContent = "";
  }
  if (els.bootRetry) els.bootRetry.hidden = true;
}

function showBootError(message) {
  els.bootScreen.hidden = false;
  els.bootScreen.setAttribute("aria-busy", "false");
  els.authScreen.hidden = true;
  els.appShell.hidden = true;
  if (els.bootError) {
    els.bootError.textContent = message || t(state.language, "sessionRestoreFailed");
    els.bootError.hidden = false;
  }
  if (els.bootRetry) els.bootRetry.hidden = false;
}

function hideBoot() {
  els.bootScreen.hidden = true;
  els.bootScreen.setAttribute("aria-busy", "false");
}

function showLogin() {
  hideBoot();
  stopAutomationCountdown();
  els.authScreen.hidden = false;
  els.appShell.hidden = true;
  els.loginForm.hidden = false;
  els.bootstrapForm.hidden = true;
  document.querySelector("#login-password").value = "";
}
function showBootstrap() {
  hideBoot();
  els.authScreen.hidden = false;
  els.appShell.hidden = true;
  els.loginForm.hidden = true;
  els.bootstrapForm.hidden = false;
  document.querySelector("#bootstrap-password").value = "";
}
function showApp() {
  hideBoot();
  els.authScreen.hidden = true;
  els.appShell.hidden = false;
  const username = String(state.user?.username || "admin");
  els.userName.textContent = username;
  els.userAvatar.textContent = username.slice(0, 1).toUpperCase();
  els.adminRouteValue.textContent = `${basePath}/`;
  activateView(state.activeView);
}

async function activateView(view) {
  if (!VIEWS[view]) return;
  state.activeView = view;
  writePreference(VIEW_KEY, view);
  document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  els.pageTitle.textContent = t(state.language, view);
  els.pageEyebrow.textContent = view === "dashboard" ? t(state.language, "overview") : `DRD / ${VIEWS[view].index}`;

  const realViews = ["dashboard", "market", "sources", "assets", "automation", "admins", "apiManagement", "loginHistory", "system", "settings"];
  for (const key of realViews) {
    const node = document.querySelector(`#${key}-view`);
    if (node) node.hidden = key !== view;
  }
  const placeholder = !realViews.includes(view);
  els.placeholderView.hidden = !placeholder;
  if (placeholder) {
    els.placeholderIndex.textContent = VIEWS[view].index;
    els.placeholderTitle.textContent = t(state.language, view);
    els.placeholderDescription.textContent = t(state.language, VIEWS[view].description);
  }
  closeSidebar();

  try {
    if (view === "dashboard") await loadDashboard();
    if (view === "market") await loadMarket();
    if (view === "sources") await loadSources();
    if (view === "assets") await loadAssets();
    if (view === "automation") await loadAutomation();
    if (view === "admins") await window.DRDAdmins?.load?.();
    if (view === "apiManagement") await apiManagementView.load();
    if (view === "loginHistory") await loginHistoryView.load();
    if (view === "system") await window.DRDSystem?.load?.();
    else stopAutomationCountdown();
    if (view === "settings") syncPreferencesForm();
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
  }
}

async function loadDashboard() {
  const { data } = await api.dashboard();
  setText("dashboard-bot-status", t(state.language, data.bot_enabled ? "enabled" : "disabled"));
  setText("dashboard-market-health", t(state.language, data.market?.partial ? "partialData" : "liveData"));
  setText("dashboard-usdt", formatToman(data.market?.usdt?.price_toman));
  setText("dashboard-usdt-source", data.market?.usdt?.source || "—");
  setText("dashboard-sources", `${data.sources?.healthy ?? 0} / ${data.sources?.total ?? 0}`);
  setText("dashboard-assets", `${data.assets?.enabled ?? 0} / ${data.assets?.total ?? 0}`);
  setText("dashboard-cache", t(state.language, data.market?.cache?.from_cache ? "fromCache" : "refreshed"));
  setText("dashboard-cache-detail", `${data.market?.cache?.ttl_seconds ?? "—"}s`);
  setText("dashboard-last-publish", formatDateTime(data.automation?.last_success_at));
  setText("dashboard-next-publish", formatDateTime(data.automation?.next_publish_at));
}

async function loadMarket() {
  const { data } = await api.market();
  renderMarket(data);
}
async function refreshMarket(event) {
  await runBusy(event.currentTarget, async () => {
    const { data } = await api.refreshMarket(state.csrfToken);
    renderMarket(data);
    showToast(t(state.language, "marketUpdated"), "success");
  });
}
async function showMarketPreview(event) {
  await runBusy(event.currentTarget, async () => {
    const { data } = await api.marketPreview();
    showPreview(data.fallback_html || data.rich?.html || "—");
  });
}
async function publishMarket(event) {
  if (!confirm(t(state.language, "publishConfirm"))) return;
  await runBusy(event.currentTarget, async () => {
    await api.publishMarket(state.csrfToken);
    showToast(t(state.language, "marketPublished"), "success");
    await loadDashboard();
  });
}
function renderMarket(data) {
  setText("market-usdt", formatToman(data.usdt?.price_toman));
  setText("market-usdt-source", data.usdt?.source || "—");
  setText("market-gram18", formatToman(data.metals?.gram_18_toman));
  setText("market-mazaneh", formatToman(data.metals?.mazaneh_toman));
  setText("market-gold", formatUsd(data.metals?.gold_usd));
  setText("market-silver", formatUsd(data.metals?.silver_usd));
  setText("market-cache", t(state.language, data.cache?.from_cache ? "fromCache" : "refreshed"));
  setText("market-cache-time", data.time ? `${data.date || ""} · ${data.time}` : "—");
  setText("crypto-count", String(data.crypto?.length || 0));
  const list = document.querySelector("#crypto-list");
  list.replaceChildren();
  for (const coin of data.crypto || []) {
    const row = el("div", "data-row");
    row.append(
      textEl("strong", state.language === "fa" ? coin.name_fa || coin.name : coin.name || coin.symbol),
      textEl("span", formatUsd(coin.price_usd), "", "ltr"),
      textEl("span", formatPercent(coin.change_24h_percent), changeClass(coin.change_24h_percent), "ltr"),
    );
    list.append(row);
  }
}

async function loadSources() {
  const { data } = await api.sources();
  state.sourceData = data;
  renderSources();
}
function renderSources() {
  const data = state.sourceData || {};
  els.sourcesList.replaceChildren();
  for (const [name, item] of Object.entries(data.sources || {})) {
    const row = el("div", "source-row");
    const title = el("div");
    title.append(textEl("strong", item.label || name), textEl("div", sourceStatusText(item), "row-meta"));
    const toggle = inputSwitch(item.enabled, async (checked, input) => {
      await mutateControl(input, async () => {
        await api.updateSource(name, checked, state.csrfToken);
        await loadSources();
        showToast(t(state.language, "sourceUpdated"), "success");
      });
    });
    const test = button(t(state.language, "test"), "secondary-button compact-button", async (buttonNode) => {
      await runBusy(buttonNode, async () => {
        await api.testSource(name, state.csrfToken);
        await loadSources();
        showToast(t(state.language, "sourceTested"), "success");
      });
    });
    row.append(title, textEl("span", formatLatency(item.status?.latency), "row-meta"), toggle, test);
    els.sourcesList.append(row);
  }
  renderPriority(data.usdt_priority || []);
}
function renderPriority(priority) {
  els.usdtPriorityList.replaceChildren();
  priority.forEach((name, index) => {
    const row = el("div", "priority-row");
    const actions = el("div", "action-row");
    const up = button("↑", "icon-button", () => movePriority(index, -1));
    const down = button("↓", "icon-button", () => movePriority(index, 1));
    up.disabled = index === 0;
    down.disabled = index === priority.length - 1;
    actions.append(up, down);
    row.append(textEl("span", String(index + 1), "nav-glyph"), textEl("strong", sourceLabel(name)), actions);
    els.usdtPriorityList.append(row);
  });
}
async function movePriority(index, delta) {
  const priority = [...(state.sourceData?.usdt_priority || [])];
  const target = index + delta;
  if (target < 0 || target >= priority.length) return;
  [priority[index], priority[target]] = [priority[target], priority[index]];
  try {
    await api.updateUsdtPriority(priority, state.csrfToken);
    await loadSources();
    showToast(t(state.language, "priorityUpdated"), "success");
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
  }
}

async function loadAssets() {
  const { data } = await api.assets();
  state.assets = data.assets || [];
  renderAssets();
}
function renderAssets() {
  const query = String(els.assetSearch?.value || "").trim().toLowerCase();
  const filtered = state.assets.filter((item) => {
    return !query || [item.id, item.name, item.name_fa, item.symbol].some((value) =>
      String(value || "").toLowerCase().includes(query)
    );
  });
  els.assetsList.replaceChildren();
  for (const item of filtered) {
    const row = el("div", "asset-row");
    const identity = el("div");
    identity.append(
      textEl("strong", state.language === "fa" ? item.name_fa || item.name : item.name),
      textEl("div", `${item.symbol || ""} · ${item.id}`, "row-meta"),
    );
    const rank = textEl("span", item.market_cap_rank == null ? "—" : `#${item.market_cap_rank}`, "row-meta");
    const toggle = inputSwitch(item.enabled, async (checked, input) => {
      await mutateControl(input, async () => {
        await api.updateAsset(item.id, checked, state.csrfToken);
        item.enabled = checked;
        renderAssets();
        showToast(t(state.language, "assetUpdated"), "success");
      });
    });
    row.append(identity, rank, toggle);
    els.assetsList.append(row);
  }
  els.assetCount.textContent = `${filtered.length} / ${state.assets.length}`;
}
async function refreshAssets(event) {
  await runBusy(event.currentTarget, async () => {
    const { data } = await api.refreshAssets(state.csrfToken);
    state.assets = data.assets || [];
    renderAssets();
    showToast(t(state.language, "assetsUpdated"), "success");
  });
}

async function loadAutomation() {
  const { data } = await api.automation();
  state.automationData = data;
  renderAutomation(data);
}
function renderAutomation(data) {
  const settings = data.settings || {};
  const diagnostics = data.diagnostics || {};
  els.automationEnabled.checked = Boolean(settings.enabled);
  renderIntervalOptions(data.interval_options || [], settings.interval_minutes);
  els.automationQuietEnabled.checked = Boolean(settings.quiet_hours?.enabled);
  els.automationQuietStart.value = settings.quiet_hours?.start || "01:00";
  els.automationQuietEnd.value = settings.quiet_hours?.end || "10:30";

  setText("automation-status", t(state.language, settings.enabled ? "enabled" : "disabled"));
  setText("automation-can-publish", `${t(state.language, "canPublishNow")}: ${t(state.language, diagnostics.can_publish_now ? "yes" : "no")}`);
  setText("automation-reason", reasonText(diagnostics.reason));
  setText("automation-current-slot", formatDateTime(diagnostics.current_slot_at));
  setText("automation-next-slot", `${t(state.language, "nextAlignedSlot")}: ${formatDateTime(diagnostics.next_aligned_slot_at)}`);
  setText("automation-next-publish", formatDateTime(diagnostics.next_publish_at));
  setText("automation-retry-slot", `${t(state.language, "retrySlot")}: ${formatDateTime(settings.retry_slot_at)}`);
  setText("automation-last-attempt", formatDateTime(settings.last_attempt_at));
  setText("automation-last-success", formatDateTime(settings.last_success_at));
  setText("automation-retry-detail", formatDateTime(settings.retry_slot_at));
  setText("automation-last-error", settings.last_error || "—");
  renderAutomationHistory(data.history || []);
  startAutomationCountdown(diagnostics.next_publish_at);
}
function renderIntervalOptions(options, selected) {
  els.automationInterval.replaceChildren();
  for (const value of options) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} ${t(state.language, "minutes")}`;
    option.selected = Number(value) === Number(selected);
    els.automationInterval.append(option);
  }
}
async function saveAutomationSettings(event) {
  event.preventDefault();
  const submit = event.submitter;
  await runBusy(submit, async () => {
    const { data } = await api.updateAutomationSettings({
      enabled: els.automationEnabled.checked,
      interval_minutes: Number(els.automationInterval.value),
      quiet_hours: {
        enabled: els.automationQuietEnabled.checked,
        start: els.automationQuietStart.value,
        end: els.automationQuietEnd.value,
      },
    }, state.csrfToken);
    state.automationData = data;
    renderAutomation(data);
    showToast(t(state.language, "automationSaved"), "success");
    await loadDashboard();
  });
}
async function automationDryRun(event) {
  await runBusy(event.currentTarget, async () => {
    const { data } = await api.automationDryRun({
      refresh_market: els.automationRefreshMarket.checked,
    }, state.csrfToken);
    showPreview(data.preview?.fallback_html || data.preview?.rich?.html || "—");
    showToast(t(state.language, "dryRunReady"), "success");
    await loadAutomation();
  });
}
async function automationForceRun(event) {
  if (!confirm(t(state.language, "forceRunConfirm"))) return;
  await runBusy(event.currentTarget, async () => {
    await api.automationForceRun({
      refresh_market: els.automationRefreshMarket.checked,
    }, state.csrfToken);
    showToast(t(state.language, "forceRunDone"), "success");
    await Promise.all([loadAutomation(), loadDashboard()]);
  });
}
async function refreshAutomationHistory(event) {
  await runBusy(event.currentTarget, async () => {
    const { data } = await api.automationHistory(20);
    if (state.automationData) state.automationData.history = data || [];
    renderAutomationHistory(data || []);
  });
}
function renderAutomationHistory(history) {
  els.automationHistory.replaceChildren();
  if (!history.length) {
    els.automationHistory.append(textEl("p", t(state.language, "noHistory"), "muted"));
    return;
  }
  for (const run of history) {
    const row = el("div", "history-row");
    row.append(
      badge(t(state.language, `mode_${run.mode}`), run.mode),
      badge(t(state.language, `status_${run.status}`), run.status),
      textEl("span", reasonText(run.reason), "row-meta"),
      textEl("span", formatDateTime(run.finished_at), "row-meta", "ltr"),
    );
    if (run.error) row.title = run.error;
    els.automationHistory.append(row);
  }
}
function startAutomationCountdown(nextPublishAt) {
  stopAutomationCountdown();
  const target = Date.parse(nextPublishAt || "");
  const render = () => {
    if (!Number.isFinite(target)) return setText("automation-countdown", "—");
    const seconds = Math.max(0, Math.ceil((target - Date.now()) / 1000));
    setText("automation-countdown", `${t(state.language, "countdown")}: ${formatDuration(seconds)}`);
    if (seconds <= 0) {
      stopAutomationCountdown();
      if (state.activeView === "automation") {
        setTimeout(() => loadAutomation().catch(() => {}), 1500);
      }
    }
  };
  render();
  state.automationCountdownTimer = setInterval(render, 1000);
}
function stopAutomationCountdown() {
  if (state.automationCountdownTimer) clearInterval(state.automationCountdownTimer);
  state.automationCountdownTimer = null;
}

function syncPreferencesForm() {
  if (!els.adminLanguageSelect) return;
  els.adminLanguageSelect.value = state.language;
  els.adminThemeSelect.value = state.theme;
  els.telegramLanguageSelect.value = state.telegramLanguage;
}
async function toggleLanguage() {
  const previous = state.language;
  state.language = state.language === "fa" ? "en" : "fa";
  writePreference(LANG_KEY, state.language);
  applyPreferences();
  if (state.user && !state.user.mustCompleteBootstrap) {
    try {
      await persistPreferences({ admin_ui_language: state.language });
    } catch (error) {
      state.language = previous;
      applyPreferences();
      showToast(error.message || t(state.language, "networkError"), "error");
      return;
    }
  }
  if (state.activeView === "automation" && state.automationData) renderAutomation(state.automationData);
  if (state.activeView === "sources" && state.sourceData) renderSources();
  if (state.activeView === "assets") renderAssets();
  if (state.activeView === "admins") window.DRDAdmins?.render?.();
  if (state.activeView === "apiManagement") apiManagementView.render();
  if (state.activeView === "loginHistory") loginHistoryView.render();
  if (state.activeView === "system") window.DRDSystem?.render?.();
  refreshLanguageButtons();
}
function cycleTheme() {
  const index = THEME_ORDER.indexOf(state.theme);
  state.theme = THEME_ORDER[(index + 1) % THEME_ORDER.length];
  writePreference(THEME_KEY, state.theme);
  applyTheme();
  if (state.user && !state.user.mustCompleteBootstrap) {
    persistPreferences({ admin_ui_theme: state.theme }).catch((error) =>
      showToast(error.message || t(state.language, "networkError"), "error")
    );
  }
}
function applyPreferences() {
  applyLanguage(state.language);
  applyTheme();
  refreshLanguageButtons();
}
function applyTheme() {
  const resolved = state.theme === "system" ? (media.matches ? "dark" : "light") : state.theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelectorAll("[data-theme-icon]").forEach((node) => {
    node.textContent = state.theme === "system" ? "◐" : state.theme === "dark" ? "●" : "○";
  });
}
function refreshLanguageButtons() {
  document.querySelectorAll('[data-action="lang-toggle"]').forEach((button) => {
    button.textContent = state.language === "fa" ? "EN" : "FA";
  });
}

function openSidebar() {
  els.sidebar.classList.add("is-open");
  els.sidebarOverlay.hidden = false;
}
function closeSidebar() {
  els.sidebar.classList.remove("is-open");
  els.sidebarOverlay.hidden = true;
}
function togglePassword(id) {
  const input = document.querySelector(`#${id}`);
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
}

function showPreview(text) {
  els.previewContent.textContent = String(text || "—");
  els.previewPanel.hidden = false;
  els.previewPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function showToast(message, type = "info") {
  els.toast.textContent = String(message || "");
  els.toast.dataset.type = type;
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 3500);
}
function showFormError(node, message) {
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
}
function clearFormError(node) {
  if (!node) return;
  node.textContent = "";
  node.hidden = true;
}
function setBusy(buttonNode, busy) {
  if (!buttonNode) return;
  buttonNode.disabled = Boolean(busy);
  buttonNode.setAttribute("aria-busy", busy ? "true" : "false");
}
async function runBusy(buttonNode, operation) {
  setBusy(buttonNode, true);
  try {
    return await operation();
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
    return null;
  } finally {
    setBusy(buttonNode, false);
  }
}
async function mutateControl(control, operation) {
  control.disabled = true;
  try { await operation(); }
  catch (error) {
    control.checked = !control.checked;
    showToast(error.message || t(state.language, "networkError"), "error");
  } finally { control.disabled = false; }
}

function inputSwitch(checked, onChange) {
  const label = el("label", "switch-row");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked, input));
  label.append(input);
  return label;
}
function button(label, className, onClick) {
  const node = textEl("button", label, className);
  node.type = "button";
  node.addEventListener("click", () => onClick(node));
  return node;
}
function badge(label, kind) {
  return textEl("span", label, `history-badge ${kind || ""}`.trim());
}
function el(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
function textEl(tag, value, className = "", dir = "") {
  const node = el(tag, className);
  node.textContent = String(value ?? "");
  if (dir) node.dir = dir;
  return node;
}
function setText(id, value) {
  const node = document.querySelector(`#${id}`);
  if (node) node.textContent = String(value ?? "—");
}
function camel(id) {
  return id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
function sourceLabel(name) {
  return ({ wallex: "Wallex", tabdeal: "Tabdeal", exir: "Exir", bitpin: "Bitpin", nobitex: "Nobitex", coingecko: "CoinGecko", wallgold: "WallGold" })[name] || name;
}
function sourceStatusText(item) {
  const status = item?.status || {};
  const health = status.success ? "OK" : status.message || "—";
  const http = status.status == null ? "—" : status.status;
  return `${health} · HTTP ${http} · ${formatDateTime(status.lastCheckedAt || status.last_checked_at)}`;
}
function reasonText(reason) {
  if (!reason) return "—";
  return t(state.language, `reason_${reason}`);
}
function formatToman(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat(state.language === "fa" ? "fa-IR" : "en-US").format(number) : "—";
}
function formatUsd(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(number)}` : "—";
}
function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number >= 0 ? "+" : ""}${number.toFixed(2)}%` : "—";
}
function changeClass(value) {
  const number = Number(value);
  return number > 0 ? "history-badge success" : number < 0 ? "history-badge error" : "";
}
function formatLatency(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number} ms` : "—";
}
function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
    return new Intl.DateTimeFormat(state.language === "fa" ? "fa-IR" : "en-GB", {
      dateStyle: "short", timeStyle: "short",
    }).format(new Date(timestamp));
  }
  return new Intl.DateTimeFormat(state.language === "fa" ? "fa-IR" : "en-GB", {
    dateStyle: "short", timeStyle: "short",
  }).format(date);
}
function formatDuration(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
function normalizeTheme(value) {
  return THEME_ORDER.includes(value) ? value : "system";
}
function readPreference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writePreference(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
