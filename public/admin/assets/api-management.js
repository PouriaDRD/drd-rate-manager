const copy = Object.freeze({
  fa: {
    title: "مدیریت API",
    intro: "توکن‌های Market و Core و وضعیت دسترسی عمومی/خصوصی بازار را مدیریت کنید.",
    reload: "بروزرسانی",
    loading: "در حال بارگذاری مدیریت API…",
    loadError: "بارگذاری مدیریت API ناموفق بود.",
    marketMode: "حالت Market API",
    public: "عمومی",
    private: "خصوصی",
    publicHelp: "در حالت عمومی، Market API بدون توکن قابل استفاده است.",
    privateHelp: "در حالت خصوصی، فقط توکن drd_mkt_* معتبر پذیرفته می‌شود.",
    saveMode: "ذخیره حالت",
    createTitle: "ساخت API Token",
    createHelp: "Secret فقط همین یک بار نمایش داده می‌شود.",
    name: "نام توکن",
    type: "نوع توکن",
    marketToken: "Market",
    coreToken: "Core",
    expiration: "انقضا",
    optionalExpiration: "اختیاری",
    create: "ساخت توکن",
    tokensTitle: "API Tokens",
    noTokens: "هنوز توکنی ساخته نشده است.",
    total: "کل توکن‌ها",
    active: "فعال",
    market: "Market",
    core: "Core",
    revoked: "لغوشده",
    enabled: "فعال",
    disabled: "غیرفعال",
    expired: "منقضی",
    usage: "استفاده",
    lastUsed: "آخرین استفاده",
    createdAt: "ساخته‌شده",
    expiresAt: "انقضا",
    never: "بدون انقضا",
    enable: "فعال‌سازی",
    disable: "غیرفعال‌سازی",
    rotate: "Rotate",
    revoke: "لغو",
    rotateConfirm: "توکن فعلی لغو و Secret جدید ساخته شود؟ Secret جدید فقط یک بار نمایش داده می‌شود.",
    revokeConfirm: "این توکن برای همیشه لغو شود؟ امکان فعال‌سازی مجدد توکن لغوشده وجود ندارد.",
    secretTitle: "Secret یک‌باره",
    secretWarning: "این مقدار دوباره از سرور قابل بازیابی نیست. همین حالا آن را در محل امن ذخیره کنید.",
    copy: "کپی",
    dismiss: "بستن و پاک‌کردن",
    copied: "توکن کپی شد.",
    createdDone: "API token ساخته شد.",
    rotatedDone: "API token با موفقیت Rotate شد.",
    modeSaved: "حالت Market API ذخیره شد.",
    enabledDone: "توکن فعال شد.",
    disabledDone: "توکن غیرفعال شد.",
    revokedDone: "توکن لغو شد.",
    rawNotRecoverable: "Secret توکن‌های قبلی قابل بازیابی نیست.",
  },
  en: {
    title: "API management",
    intro: "Manage Market/Core tokens and the public/private Market API access policy.",
    reload: "Refresh",
    loading: "Loading API management…",
    loadError: "API management could not be loaded.",
    marketMode: "Market API mode",
    public: "Public",
    private: "Private",
    publicHelp: "In public mode, Market APIs are available without a token.",
    privateHelp: "In private mode, only a valid drd_mkt_* token is accepted.",
    saveMode: "Save mode",
    createTitle: "Create API token",
    createHelp: "The secret is displayed once only.",
    name: "Token name",
    type: "Token type",
    marketToken: "Market",
    coreToken: "Core",
    expiration: "Expiration",
    optionalExpiration: "Optional",
    create: "Create token",
    tokensTitle: "API tokens",
    noTokens: "No API tokens have been created yet.",
    total: "Total tokens",
    active: "Active",
    market: "Market",
    core: "Core",
    revoked: "Revoked",
    enabled: "Enabled",
    disabled: "Disabled",
    expired: "Expired",
    usage: "Usage",
    lastUsed: "Last used",
    createdAt: "Created",
    expiresAt: "Expires",
    never: "Never",
    enable: "Enable",
    disable: "Disable",
    rotate: "Rotate",
    revoke: "Revoke",
    rotateConfirm: "Revoke the current token and generate a new secret? The new secret is shown once only.",
    revokeConfirm: "Permanently revoke this token? Revoked tokens cannot be re-enabled.",
    secretTitle: "One-time secret",
    secretWarning: "This value cannot be recovered from the server later. Store it securely now.",
    copy: "Copy",
    dismiss: "Dismiss & clear",
    copied: "Token copied.",
    createdDone: "API token created.",
    rotatedDone: "API token rotated.",
    modeSaved: "Market API mode saved.",
    enabledDone: "Token enabled.",
    disabledDone: "Token disabled.",
    revokedDone: "Token revoked.",
    rawNotRecoverable: "Existing token secrets cannot be recovered.",
  },
});

const state = {
  data: null,
  secret: "",
};

const root = document.querySelector("#api-management-view");
const reload = document.querySelector("#api-management-reload");
const modeForm = document.querySelector("#api-market-mode-form");
const modeSelect = document.querySelector("#api-market-mode");
const modeHelp = document.querySelector("#api-market-mode-help");
const createForm = document.querySelector("#api-token-create-form");
const tokenName = document.querySelector("#api-token-name");
const tokenType = document.querySelector("#api-token-type");
const tokenExpiration = document.querySelector("#api-token-expiration");
const list = document.querySelector("#api-token-list");
const secretPanel = document.querySelector("#api-secret-panel");
const secretValue = document.querySelector("#api-secret-value");
const copySecretButton = document.querySelector("#api-secret-copy");
const dismissSecretButton = document.querySelector("#api-secret-dismiss");

reload?.addEventListener("click", () => withBusy(reload, load));
modeForm?.addEventListener("submit", saveMarketMode);
createForm?.addEventListener("submit", createToken);
copySecretButton?.addEventListener("click", copySecret);
dismissSecretButton?.addEventListener("click", clearSecret);
modeSelect?.addEventListener("change", renderModeHelp);

export const apiManagementView = Object.freeze({
  load,
  render,
  reset,
});

window.DRDApiManagement = apiManagementView;

async function load() {
  clearSecret();
  renderLoading();
  try {
    const payload = await bridge().apiManagementSnapshot();
    state.data = payload.data || {
      market_mode: "public",
      tokens: [],
      stats: {},
      capabilities: {},
    };
    render();
  } catch (error) {
    state.data = null;
    renderLoadError(error);
    throw error;
  }
}

function renderLoading() {
  applyCopy();
  for (const id of [
    "api-stat-total",
    "api-stat-active",
    "api-stat-market",
    "api-stat-core",
    "api-stat-revoked",
  ]) {
    setText(id, "…");
  }
  list?.replaceChildren(textNode("p", tr("loading"), "api-empty"));
}

function renderLoadError(error) {
  applyCopy();
  for (const id of [
    "api-stat-total",
    "api-stat-active",
    "api-stat-market",
    "api-stat-core",
    "api-stat-revoked",
  ]) {
    setText(id, "—");
  }
  const message = String(error?.message || "").trim();
  const text = message ? `${tr("loadError")} ${message}` : tr("loadError");
  list?.replaceChildren(textNode("p", text, "api-empty"));
}

function reset() {
  state.data = null;
  clearSecret();
  list?.replaceChildren();
}

function render() {
  if (!root) return;
  applyCopy();
  const data = state.data || {};
  const stats = data.stats || {};

  setText("api-stat-total", stats.total ?? 0);
  setText("api-stat-active", stats.active ?? 0);
  setText("api-stat-market", stats.market ?? 0);
  setText("api-stat-core", stats.core ?? 0);
  setText("api-stat-revoked", stats.revoked ?? 0);

  if (modeSelect) modeSelect.value = data.market_mode === "private" ? "private" : "public";
  renderModeHelp();
  renderTokens();
  renderSecret();
}

function renderModeHelp() {
  if (!modeHelp || !modeSelect) return;
  modeHelp.textContent = tr(modeSelect.value === "private" ? "privateHelp" : "publicHelp");
}

function renderTokens() {
  if (!list) return;
  list.replaceChildren();
  const tokens = state.data?.tokens || [];
  if (!tokens.length) {
    list.append(textNode("p", tr("noTokens"), "api-empty"));
    return;
  }
  for (const token of tokens) list.append(renderToken(token));
}

function renderToken(token) {
  const status = tokenStatus(token);
  const card = node("article", `api-token-card status-${status}`);

  const head = node("div", "api-token-head");
  const identity = node("div", "api-token-identity");
  const title = node("div", "api-token-title");
  title.append(
    textNode("strong", token.name || `#${token.id}`),
    badge(token.type === "market" ? tr("marketToken") : tr("coreToken"), token.type),
    badge(tr(status), status),
  );
  identity.append(
    title,
    textNode("code", token.prefix || "—", "api-token-prefix", "ltr"),
  );
  head.append(identity);

  const meta = node("div", "api-token-meta");
  meta.append(
    metaItem(tr("usage"), String(token.usage_count ?? 0)),
    metaItem(tr("lastUsed"), formatDateTime(token.last_used_at)),
    metaItem(tr("createdAt"), formatDateTime(token.created_at)),
    metaItem(tr("expiresAt"), token.expires_at ? formatDateTime(token.expires_at) : tr("never")),
  );

  const actions = node("div", "api-token-actions");
  const revoked = Boolean(token.revoked_at);
  if (!revoked) {
    const enabledButton = actionButton(
      token.enabled ? tr("disable") : tr("enable"),
      token.enabled ? "secondary-button compact-button" : "primary-button compact-button",
      async (button) => {
        await withBusy(button, async () => {
          await bridge().setApiTokenEnabled(token.id, !token.enabled);
          bridge().toast(token.enabled ? tr("disabledDone") : tr("enabledDone"), "success");
          await load();
        });
      },
    );

    const rotateButton = actionButton(
      tr("rotate"),
      "secondary-button compact-button",
      async (button) => {
        if (!confirm(tr("rotateConfirm"))) return;
        await withBusy(button, async () => {
          const payload = await bridge().rotateApiToken(token.id);
          await load();
          showSecret(payload.data?.token || "");
          bridge().toast(tr("rotatedDone"), "success");
        });
      },
    );

    const revokeButton = actionButton(
      tr("revoke"),
      "danger-button compact-button",
      async (button) => {
        if (!confirm(tr("revokeConfirm"))) return;
        await withBusy(button, async () => {
          await bridge().revokeApiToken(token.id);
          bridge().toast(tr("revokedDone"), "success");
          await load();
        });
      },
    );
    actions.append(enabledButton, rotateButton, revokeButton);
  }

  card.append(head, meta, actions);
  return card;
}

async function saveMarketMode(event) {
  event.preventDefault();
  const submit = event.submitter;
  await withBusy(submit, async () => {
    const payload = await bridge().setMarketApiMode(modeSelect.value);
    if (state.data) state.data.market_mode = payload.data?.market_mode || modeSelect.value;
    bridge().toast(tr("modeSaved"), "success");
    render();
  });
}

async function createToken(event) {
  event.preventDefault();
  const submit = event.submitter;
  const name = String(tokenName?.value || "").trim();
  if (!name) {
    tokenName?.focus();
    return;
  }

  const expiresAt = tokenExpiration?.value
    ? new Date(tokenExpiration.value).toISOString()
    : "";

  await withBusy(submit, async () => {
    const payload = await bridge().createApiToken({
      name,
      type: tokenType?.value || "market",
      expires_at: expiresAt,
    });
    if (tokenName) tokenName.value = "";
    if (tokenExpiration) tokenExpiration.value = "";
    await load();
    showSecret(payload.data?.token || "");
    bridge().toast(tr("createdDone"), "success");
  });
}

function showSecret(value) {
  state.secret = String(value || "");
  renderSecret();
  secretPanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearSecret() {
  state.secret = "";
  if (secretValue) secretValue.textContent = "";
  if (secretPanel) secretPanel.hidden = true;
}

function renderSecret() {
  if (!secretPanel || !secretValue) return;
  secretPanel.hidden = !state.secret;
  secretValue.textContent = state.secret;
}

async function copySecret() {
  if (!state.secret) return;
  try {
    await navigator.clipboard.writeText(state.secret);
    bridge().toast(tr("copied"), "success");
  } catch {
    bridge().toast("Clipboard unavailable.", "error");
  }
}

function tokenStatus(token) {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) return "expired";
  return token.enabled ? "enabled" : "disabled";
}

function applyCopy() {
  root.querySelectorAll("[data-api-i18n]").forEach((element) => {
    element.textContent = tr(element.dataset.apiI18n);
  });
  root.querySelectorAll("[data-api-i18n-placeholder]").forEach((element) => {
    element.placeholder = tr(element.dataset.apiI18nPlaceholder);
  });
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

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language() === "fa" ? "fa-IR" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function metaItem(label, value) {
  const item = node("div", "api-token-meta-item");
  item.append(
    textNode("span", label, "api-token-meta-label"),
    textNode("strong", value),
  );
  return item;
}

function badge(label, kind) {
  return textNode("span", label, `api-badge ${kind || ""}`.trim());
}

function actionButton(label, className, handler) {
  const button = textNode("button", label, className);
  button.type = "button";
  button.addEventListener("click", () => handler(button));
  return button;
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
