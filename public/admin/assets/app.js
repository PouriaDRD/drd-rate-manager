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
  activeView: "dashboard",
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
  themeValue: document.querySelector("#theme-value"),
  languageValue: document.querySelector("#language-value"),
  pageTitle: document.querySelector("#page-title"),
  pageEyebrow: document.querySelector("#page-eyebrow"),
  dashboardView: document.querySelector("#dashboard-view"),
  placeholderView: document.querySelector("#placeholder-view"),
  placeholderIndex: document.querySelector("#placeholder-index"),
  placeholderTitle: document.querySelector("#placeholder-title"),
  placeholderDescription: document.querySelector("#placeholder-description"),
  sidebar: document.querySelector("#sidebar"),
  sidebarOverlay: document.querySelector("#sidebar-overlay"),
  toast: document.querySelector("#toast"),
  logout: document.querySelector("#logout-button"),
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
  els.logout?.addEventListener("click", submitLogout);
  media.addEventListener?.("change", () => {
    if (state.theme === "system") applyTheme();
  });
}

async function restoreSession() {
  try {
    const payload = await api.session();
    state.user = payload.user;
    state.csrfToken = payload.csrf_token || "";
    if (payload.user?.mustCompleteBootstrap) showBootstrap();
    else showApp();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showLogin();
      return;
    }
    showLogin();
    showToast(t(state.language, "networkError"), "error");
  }
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
    else showApp();
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
  refreshPreferenceLabels();
}

function activateView(view) {
  if (!VIEWS[view]) return;
  state.activeView = view;
  document.querySelectorAll(".nav-item[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });

  els.pageTitle.textContent = t(state.language, view);
  els.pageEyebrow.textContent = view === "dashboard" ? t(state.language, "overview") : `DRD / ${VIEWS[view].index}`;

  const dashboard = view === "dashboard";
  els.dashboardView.hidden = !dashboard;
  els.placeholderView.hidden = dashboard;
  if (!dashboard) {
    els.placeholderIndex.textContent = VIEWS[view].index;
    els.placeholderTitle.textContent = t(state.language, view);
    els.placeholderDescription.textContent = t(state.language, VIEWS[view].description);
  }
  closeSidebar();
}

function toggleLanguage() {
  state.language = state.language === "fa" ? "en" : "fa";
  writePreference(LANG_KEY, state.language);
  applyLanguage(state.language);
  refreshLanguageButtons();
  refreshPreferenceLabels();
  activateView(state.activeView);
}

function cycleTheme() {
  const index = THEME_ORDER.indexOf(state.theme);
  state.theme = THEME_ORDER[(index + 1) % THEME_ORDER.length];
  writePreference(THEME_KEY, state.theme);
  applyTheme();
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
  refreshPreferenceLabels();
}

function refreshLanguageButtons() {
  document.querySelectorAll('[data-action="lang-toggle"]').forEach((button) => {
    button.textContent = state.language === "fa" ? "EN" : "فا";
  });
}

function refreshPreferenceLabels() {
  if (els.themeValue) els.themeValue.textContent = t(state.language, `theme${capitalize(state.theme)}`);
  if (els.languageValue) els.languageValue.textContent = state.language === "fa" ? "فارسی" : "English";
}

function togglePassword(id) {
  const input = document.getElementById(id);
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
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
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4200);
}

function readPreference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function writePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* non-critical */ }
}

function normalizeTheme(value) {
  return THEME_ORDER.includes(value) ? value : "system";
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
