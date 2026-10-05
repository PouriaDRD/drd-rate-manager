import { AdminApi, ApiError } from "./api.js";
import { applyLanguage, normalizeLanguage, t } from "./i18n.js";

const THEME_KEY = "drd-admin-theme";
const LANG_KEY = "drd-admin-lang";
const THEME_ORDER = ["system", "dark", "light"];
const VIEWS = Object.freeze({
  dashboard: { index: "01", description: "dashboardIntro" },
  market: { index: "02", description: "viewMarket" },
  sources: { index: "03", description: "viewSources" },
  assets: { index: "04", description: "viewAssets" },
  automation: { index: "05", description: "viewAutomation" },
  admins: { index: "06", description: "viewAdmins" },
  system: { index: "07", description: "viewSystem" },
  settings: { index: "08", description: "viewSettings" },
});

const state = {
  csrfToken: "",
  user: null,
  language: normalizeLanguage(readPreference(LANG_KEY, "fa")),
  theme: normalizeTheme(readPreference(THEME_KEY, "system")),
  telegramLanguage: "fa",
  activeView: "dashboard",
  sourceData: null,
  assets: [],
};

const basePath = `/${location.pathname.split("/").filter(Boolean)[0] || "admin"}`;
const api = new AdminApi(basePath);
const media = matchMedia("(prefers-color-scheme: dark)");

const els = {
  authScreen: document.querySelector("#auth-screen"),
  appShell: document.querySelector("#app-shell"),
  loginForm: document.querySelector("#login-form"),
  bootstrapForm: document.querySelector("#bootstrap-form"),
  loginError: document.querySelector("#login-error"),
  bootstrapError: document.querySelector("#bootstrap-error"),
  userName: document.querySelector("#user-name"),
  userAvatar: document.querySelector("#user-avatar"),
  adminRoute: document.querySelector("#admin-route-value"),
  pageTitle: document.querySelector("#page-title"),
  pageEyebrow: document.querySelector("#page-eyebrow"),
  dashboardView: document.querySelector("#dashboard-view"),
  marketView: document.querySelector("#market-view"),
  sourcesView: document.querySelector("#sources-view"),
  assetsView: document.querySelector("#assets-view"),
  settingsView: document.querySelector("#settings-view"),
  placeholderView: document.querySelector("#placeholder-view"),
  placeholderIndex: document.querySelector("#placeholder-index"),
  placeholderTitle: document.querySelector("#placeholder-title"),
  placeholderDescription: document.querySelector("#placeholder-description"),
  sidebar: document.querySelector("#sidebar"),
  sidebarOverlay: document.querySelector("#sidebar-overlay"),
  toast: document.querySelector("#toast"),
  logout: document.querySelector("#logout-button"),
  preferencesForm: document.querySelector("#preferences-form"),
  adminLanguage: document.querySelector("#admin-language-select"),
  adminTheme: document.querySelector("#admin-theme-select"),
  telegramLanguage: document.querySelector("#telegram-language-select"),
  previewPanel: document.querySelector("#preview-panel"),
  previewContent: document.querySelector("#preview-content"),
  sourcesList: document.querySelector("#sources-list"),
  priorityList: document.querySelector("#usdt-priority-list"),
  assetsList: document.querySelector("#assets-list"),
  assetSearch: document.querySelector("#asset-search"),
};

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
  els.logout?.addEventListener("click", submitLogout);
  document.querySelector("#market-refresh")?.addEventListener("click", refreshMarket);
  document.querySelector("#market-preview")?.addEventListener("click", showMarketPreview);
  document.querySelector("#market-publish")?.addEventListener("click", publishMarket);
  document.querySelector("#sources-reload")?.addEventListener("click", loadSources);
  document.querySelector("#assets-refresh")?.addEventListener("click", refreshAssets);
  els.assetSearch?.addEventListener("input", renderAssets);
  document.querySelector("#preview-close")?.addEventListener("click", () => {
    els.previewPanel.hidden = true;
  });
  media.addEventListener?.("change", () => {
    if (state.theme === "system") applyTheme();
  });
}

async function restoreSession() {
  try {
    const payload = await api.session();
    state.user = payload.user;
    state.csrfToken = payload.csrf_token || "";
    if (payload.user?.mustCompleteBootstrap) {
      showBootstrap();
      return;
    }
    await hydratePreferences();
    showApp();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showLogin();
      return;
    }
    showLogin();
    showToast(t(state.language, "networkError"), "error");
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
    const payload = await api.bootstrap(
      {
        username: document.querySelector("#bootstrap-username").value,
        password: document.querySelector("#bootstrap-password").value,
        admin_path: document.querySelector("#bootstrap-path").value,
      },
      state.csrfToken,
    );
    showToast(t(state.language, "bootstrapDone"), "success");
    const nextPath = String(payload.admin_path || "").replace(/\/$/, "");
    location.replace(`${location.origin}${nextPath}/`);
  } catch (error) {
    showFormError(els.bootstrapError, error.message || t(state.language, "bootstrapFailed"));
    setBusy(submit, false);
  }
}

async function submitLogout() {
  if (!state.csrfToken) return;
  setBusy(els.logout, true);
  try {
    await api.logout(state.csrfToken);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      showToast(error.message || t(state.language, "networkError"), "error");
      setBusy(els.logout, false);
      return;
    }
  }
  state.user = null;
  state.csrfToken = "";
  showLogin();
  showToast(t(state.language, "signedOut"), "success");
  setBusy(els.logout, false);
}

async function savePreferencesForm(event) {
  event.preventDefault();
  const submit = event.submitter;
  setBusy(submit, true);
  try {
    await persistPreferences({
      admin_ui_language: els.adminLanguage.value,
      admin_ui_theme: els.adminTheme.value,
      telegram_language: els.telegramLanguage.value,
    });
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
  } finally {
    setBusy(submit, false);
  }
}

function showLogin() {
  els.authScreen.hidden = false;
  els.appShell.hidden = true;
  els.loginForm.hidden = false;
  els.bootstrapForm.hidden = true;
  document.querySelector("#login-password").value = "";
  requestAnimationFrame(() => document.querySelector("#login-username")?.focus());
}

function showBootstrap() {
  els.authScreen.hidden = false;
  els.appShell.hidden = true;
  els.loginForm.hidden = true;
  els.bootstrapForm.hidden = false;
  document.querySelector("#bootstrap-password").value = "";
  requestAnimationFrame(() => document.querySelector("#bootstrap-username")?.focus());
}

function showApp() {
  els.authScreen.hidden = true;
  els.appShell.hidden = false;
  const username = String(state.user?.username || "admin");
  els.userName.textContent = username;
  els.userAvatar.textContent = username.slice(0, 1).toUpperCase();
  els.adminRoute.textContent = `${basePath}/`;
  activateView(state.activeView);
}

async function activateView(view) {
  if (!VIEWS[view]) return;
  state.activeView = view;
  document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  els.pageTitle.textContent = t(state.language, view);
  els.pageEyebrow.textContent = view === "dashboard" ? t(state.language, "overview") : `DRD / ${VIEWS[view].index}`;

  els.dashboardView.hidden = view !== "dashboard";
  els.marketView.hidden = view !== "market";
  els.sourcesView.hidden = view !== "sources";
  els.assetsView.hidden = view !== "assets";
  els.settingsView.hidden = view !== "settings";
  const placeholder = !["dashboard", "market", "sources", "assets", "settings"].includes(view);
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
  setBusy(event.currentTarget, true);
  try {
    const { data } = await api.refreshMarket(state.csrfToken);
    renderMarket(data);
    showToast(t(state.language, "marketUpdated"), "success");
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
}

async function showMarketPreview(event) {
  setBusy(event.currentTarget, true);
  try {
    const { data } = await api.marketPreview();
    els.previewContent.textContent = data.fallback_html || data.rich?.html || "—";
    els.previewPanel.hidden = false;
    els.previewPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
}

async function publishMarket(event) {
  if (!confirm(t(state.language, "publishConfirm"))) return;
  setBusy(event.currentTarget, true);
  try {
    await api.publishMarket(state.csrfToken);
    showToast(t(state.language, "marketPublished"), "success");
    await loadDashboard();
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
  } finally {
    setBusy(event.currentTarget, false);
  }
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
    const row = document.createElement("div");
    row.className = "data-row";
    const name = document.createElement("strong");
    name.textContent = state.language === "fa" ? coin.name_fa || coin.name : coin.name || coin.symbol;
    const price = document.createElement("span");
    price.textContent = formatUsd(coin.price_usd);
    price.dir = "ltr";
    const change = document.createElement("span");
    const value = Number(coin.change_24h_percent);
    change.textContent = Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
    change.className = value > 0 ? "change-positive" : value < 0 ? "change-negative" : "";
    change.dir = "ltr";
    row.append(name, price, change);
    list.append(row);
  }
}

async function loadSources() {
  const { data } = await api.sources();
  state.sourceData = data || { sources: {}, usdt_priority: [] };
  renderSources();
}

function renderSources() {
  if (!state.sourceData) return;
  els.sourcesList.replaceChildren();
  for (const source of Object.values(state.sourceData.sources || {})) {
    const card = document.createElement("article");
    card.className = "panel-card source-card";

    const head = document.createElement("div");
    head.className = "source-card-head";
    const identity = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = source.label;
    const kind = document.createElement("span");
    kind.className = "metric-detail";
    kind.textContent = source.kind === "usdt" ? "USDT / TMN" : source.kind === "gold" ? "Iran Gold" : "Global Market";
    identity.append(title, kind);

    const toggle = document.createElement("button");
    toggle.className = source.enabled ? "status-button is-enabled" : "status-button";
    toggle.type = "button";
    toggle.textContent = t(state.language, source.enabled ? "sourceEnabled" : "sourceDisabled");
    toggle.addEventListener("click", () => updateSourceState(source.name, !source.enabled, toggle));
    head.append(identity, toggle);

    const status = source.status || {};
    const grid = document.createElement("div");
    grid.className = "source-meta-grid";
    grid.append(
      sourceMeta(t(state.language, "sourceStatus"), status.success ? "OK" : status.message || "—"),
      sourceMeta(t(state.language, "httpStatus"), status.status ?? "—"),
      sourceMeta(t(state.language, "latency"), status.latency == null ? "—" : `${status.latency}ms`),
      sourceMeta(t(state.language, "lastCheck"), status.lastCheckedAt ? formatDateTime(status.lastCheckedAt) : t(state.language, "neverChecked")),
    );

    const actions = document.createElement("div");
    actions.className = "action-row";
    const testButton = document.createElement("button");
    testButton.className = "secondary-button compact-button";
    testButton.type = "button";
    testButton.textContent = t(state.language, "testSource");
    testButton.addEventListener("click", () => testSource(source.name, testButton));
    actions.append(testButton);

    card.append(head, grid, actions);
    els.sourcesList.append(card);
  }
  renderPriority();
}

function sourceMeta(label, value) {
  const box = document.createElement("div");
  box.className = "source-meta";
  const key = document.createElement("span");
  key.textContent = label;
  const content = document.createElement("strong");
  content.textContent = String(value ?? "—");
  box.append(key, content);
  return box;
}

function renderPriority() {
  els.priorityList.replaceChildren();
  const priority = [...(state.sourceData?.usdt_priority || [])];
  priority.forEach((sourceName, index) => {
    const row = document.createElement("div");
    row.className = "priority-row";
    const position = document.createElement("span");
    position.className = "priority-index";
    position.textContent = String(index + 1).padStart(2, "0");
    const label = document.createElement("strong");
    label.textContent = state.sourceData?.sources?.[sourceName]?.label || sourceName;
    const actions = document.createElement("div");
    actions.className = "priority-actions";
    for (const [delta, key, glyph] of [[-1, "moveUp", "↑"], [1, "moveDown", "↓"]]) {
      const button = document.createElement("button");
      button.className = "icon-button mini-icon";
      button.type = "button";
      button.textContent = glyph;
      button.title = t(state.language, key);
      button.disabled = index + delta < 0 || index + delta >= priority.length;
      button.addEventListener("click", () => movePriority(index, index + delta, button));
      actions.append(button);
    }
    row.append(position, label, actions);
    els.priorityList.append(row);
  });
}

async function movePriority(from, to, button) {
  if (!state.sourceData || from === to) return;
  const next = [...state.sourceData.usdt_priority];
  [next[from], next[to]] = [next[to], next[from]];
  setBusy(button, true);
  try {
    const { data } = await api.updateUsdtPriority(next, state.csrfToken);
    state.sourceData.usdt_priority = data.usdt_priority;
    renderPriority();
    showToast(t(state.language, "prioritySaved"), "success");
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
    setBusy(button, false);
  }
}

async function updateSourceState(source, enabled, button) {
  setBusy(button, true);
  try {
    await api.updateSource(source, enabled, state.csrfToken);
    await loadSources();
    showToast(t(state.language, "sourceUpdated"), "success");
    await loadDashboard();
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
    setBusy(button, false);
  }
}

async function testSource(source, button) {
  setBusy(button, true);
  try {
    await api.testSource(source, state.csrfToken);
    await loadSources();
    showToast(t(state.language, "sourceTested"), "success");
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
    setBusy(button, false);
  }
}

async function loadAssets() {
  const { data } = await api.assets();
  state.assets = data.assets || [];
  setText("assets-enabled-count", data.enabled_count ?? 0);
  setText("assets-total-count", data.count ?? 0);
  renderAssets();
}

function renderAssets() {
  if (!els.assetsList) return;
  const query = String(els.assetSearch?.value || "").trim().toLowerCase();
  const filtered = state.assets.filter((asset) => {
    if (!query) return true;
    return [asset.id, asset.symbol, asset.name, asset.name_fa]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  els.assetsList.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact-empty";
    empty.textContent = t(state.language, "noAssets");
    els.assetsList.append(empty);
    return;
  }
  for (const asset of filtered) {
    const row = document.createElement("article");
    row.className = "panel-card asset-row";
    const identity = document.createElement("div");
    identity.className = "asset-identity";
    const symbol = document.createElement("strong");
    symbol.textContent = asset.symbol || asset.id;
    const name = document.createElement("span");
    name.textContent = state.language === "fa" ? asset.name_fa || asset.name : asset.name || asset.id;
    identity.append(symbol, name);
    const rank = document.createElement("span");
    rank.className = "asset-rank";
    rank.textContent = asset.market_cap_rank == null ? "—" : `#${asset.market_cap_rank}`;
    const toggle = document.createElement("button");
    toggle.className = asset.enabled ? "status-button is-enabled" : "status-button";
    toggle.type = "button";
    toggle.textContent = t(state.language, asset.enabled ? "sourceEnabled" : "sourceDisabled");
    toggle.addEventListener("click", () => updateAssetState(asset.id, !asset.enabled, toggle));
    row.append(identity, rank, toggle);
    els.assetsList.append(row);
  }
}

async function updateAssetState(id, enabled, button) {
  setBusy(button, true);
  try {
    await api.updateAsset(id, enabled, state.csrfToken);
    await loadAssets();
    showToast(t(state.language, "assetUpdated"), "success");
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
    setBusy(button, false);
  }
}

async function refreshAssets(event) {
  const button = event?.currentTarget;
  setBusy(button, true);
  try {
    const { data } = await api.refreshAssets(state.csrfToken);
    state.assets = data.assets || [];
    setText("assets-enabled-count", data.enabled_count ?? 0);
    setText("assets-total-count", data.count ?? 0);
    renderAssets();
    showToast(t(state.language, "assetsRefreshed"), "success");
  } catch (error) {
    showToast(error.message || t(state.language, "networkError"), "error");
  } finally {
    setBusy(button, false);
  }
}

async function toggleLanguage() {
  const previous = state.language;
  state.language = state.language === "fa" ? "en" : "fa";
  writePreference(LANG_KEY, state.language);
  applyLanguage(state.language);
  refreshLanguageButtons();
  activateView(state.activeView);
  if (state.user && !state.user.mustCompleteBootstrap) {
    try {
      await persistPreferences({ admin_ui_language: state.language });
    } catch (error) {
      state.language = previous;
      applyPreferences();
      showToast(error.message || t(state.language, "networkError"), "error");
    }
  }
}

async function cycleTheme() {
  const previous = state.theme;
  const index = THEME_ORDER.indexOf(state.theme);
  state.theme = THEME_ORDER[(index + 1) % THEME_ORDER.length];
  writePreference(THEME_KEY, state.theme);
  applyTheme();
  if (state.user && !state.user.mustCompleteBootstrap) {
    try {
      await persistPreferences({ admin_ui_theme: state.theme });
    } catch (error) {
      state.theme = previous;
      applyTheme();
      showToast(error.message || t(state.language, "networkError"), "error");
    }
  }
}

function applyPreferences() {
  applyLanguage(state.language);
  applyTheme();
  refreshLanguageButtons();
  syncPreferencesForm();
}

function applyTheme() {
  const resolved = state.theme === "system" ? (media.matches ? "dark" : "light") : state.theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelectorAll("[data-theme-icon]").forEach((node) => {
    node.textContent = state.theme === "system" ? "◐" : state.theme === "dark" ? "●" : "○";
  });
}

function syncPreferencesForm() {
  if (els.adminLanguage) els.adminLanguage.value = state.language;
  if (els.adminTheme) els.adminTheme.value = state.theme;
  if (els.telegramLanguage) els.telegramLanguage.value = state.telegramLanguage;
}

function refreshLanguageButtons() {
  document.querySelectorAll('[data-action="lang-toggle"]').forEach((button) => {
    button.textContent = state.language === "fa" ? "EN" : "فا";
  });
}

function togglePassword(id) {
  const input = document.getElementById(id);
  if (input) input.type = input.type === "password" ? "text" : "password";
}

function openSidebar() {
  els.sidebar?.classList.add("is-open");
  if (els.sidebarOverlay) els.sidebarOverlay.hidden = false;
}

function closeSidebar() {
  els.sidebar?.classList.remove("is-open");
  if (els.sidebarOverlay) els.sidebarOverlay.hidden = true;
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value == null || value === "" ? "—" : String(value);
}

function formatToman(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const locale = state.language === "fa" ? "fa-IR" : "en-US";
  const unit = state.language === "fa" ? "تومان" : "Toman";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(number)} ${unit}`;
}

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: number >= 100 ? 2 : 4,
  }).format(number);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(state.language === "fa" ? "fa-IR" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function showFormError(node, message) {
  if (!node) return;
  node.textContent = String(message || "");
  node.hidden = false;
}

function clearFormError(node) {
  if (!node) return;
  node.textContent = "";
  node.hidden = true;
}

let toastTimer = 0;
function showToast(message, kind = "") {
  clearTimeout(toastTimer);
  els.toast.textContent = String(message || "");
  els.toast.className = `toast${kind ? ` is-${kind}` : ""}`;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

function readPreference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local cache is optional. D1 remains the authenticated source of truth.
  }
}

function normalizeTheme(value) {
  return THEME_ORDER.includes(value) ? value : "system";
}
