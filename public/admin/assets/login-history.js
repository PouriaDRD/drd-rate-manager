const copy = Object.freeze({
  fa: {
    title: "امنیت ورود",
    intro: "تاریخچه‌ی ورود Web Admin و رویدادهای امنیتی ثبت‌شده را بررسی کنید.",
    reload: "بروزرسانی",
    total: "کل رویدادها",
    success: "ورود موفق",
    failure: "ناموفق",
    locked: "قفل‌شده",
    filter: "فیلتر نتیجه",
    all: "همه",
    history: "تاریخچه ورود",
    noHistory: "رویدادی برای این فیلتر ثبت نشده است.",
    username: "نام کاربری",
    result: "نتیجه",
    reason: "دلیل",
    ip: "IP",
    location: "موقعیت",
    time: "زمان",
    details: "جزئیات امنیتی",
    userAgent: "User-Agent",
    cfRay: "CF-Ray",
    asn: "ASN",
    timezone: "Timezone",
    sessionRef: "Session reference",
    previous: "قبلی",
    next: "بعدی",
    pageStatus: "نمایش {from} تا {to} از {total}",
    unknown: "نامشخص",
    reason_authenticated: "احراز هویت موفق",
    reason_invalid_credentials: "نام کاربری یا رمز عبور نامعتبر",
    reason_invalid_credentials_lockout: "قفل شدن پس از تلاش‌های ناموفق",
    reason_rate_limited: "تلاش در زمان قفل بودن",
  },
  en: {
    title: "Login security",
    intro: "Review persistent Web Admin login history and recorded security events.",
    reload: "Refresh",
    total: "Total events",
    success: "Successful",
    failure: "Failed",
    locked: "Locked",
    filter: "Result filter",
    all: "All",
    history: "Login history",
    noHistory: "No events match this filter.",
    username: "Username",
    result: "Result",
    reason: "Reason",
    ip: "IP",
    location: "Location",
    time: "Time",
    details: "Security details",
    userAgent: "User-Agent",
    cfRay: "CF-Ray",
    asn: "ASN",
    timezone: "Timezone",
    sessionRef: "Session reference",
    previous: "Previous",
    next: "Next",
    pageStatus: "Showing {from}–{to} of {total}",
    unknown: "Unknown",
    reason_authenticated: "Authenticated",
    reason_invalid_credentials: "Invalid credentials",
    reason_invalid_credentials_lockout: "Locked after repeated failures",
    reason_rate_limited: "Attempt during active lockout",
  },
});

const PAGE_SIZE = 25;
const VALID_RESULTS = new Set(["all", "success", "failure", "locked"]);

const state = {
  data: null,
  result: "all",
  offset: 0,
  limit: PAGE_SIZE,
};

const root = document.querySelector("#login-history-view");
const list = document.querySelector("#login-history-list");
const filter = document.querySelector("#login-history-filter");
const reload = document.querySelector("#login-history-reload");
const previous = document.querySelector("#login-history-prev");
const next = document.querySelector("#login-history-next");

reload?.addEventListener("click", () => withBusy(reload, () => load()));
filter?.addEventListener("change", () => {
  state.result = VALID_RESULTS.has(filter.value) ? filter.value : "all";
  state.offset = 0;
  withBusy(filter, () => load()).catch(() => {});
});
previous?.addEventListener("click", () => {
  state.offset = Math.max(0, state.offset - state.limit);
  withBusy(previous, () => load()).catch(() => {});
});
next?.addEventListener("click", () => {
  if (!state.data?.pagination?.has_more) return;
  state.offset += state.limit;
  withBusy(next, () => load()).catch(() => {});
});

window.DRDLoginHistory = Object.freeze({ load, render, reset });

async function load() {
  const payload = await bridge().loginHistory({
    limit: state.limit,
    offset: state.offset,
    result: state.result,
  });
  state.data = payload.data || {
    items: [],
    stats: { total: 0, success: 0, failure: 0, locked: 0 },
    pagination: { limit: state.limit, offset: state.offset, total: 0, has_more: false },
    filter: { result: state.result },
  };
  const serverResult = String(state.data.filter?.result || state.result).toLowerCase();
  state.result = VALID_RESULTS.has(serverResult) ? serverResult : "all";
  state.offset = Number(state.data.pagination?.offset ?? state.offset) || 0;
  state.limit = Number(state.data.pagination?.limit ?? state.limit) || PAGE_SIZE;
  render();
}

function reset() {
  state.data = null;
  state.result = "all";
  state.offset = 0;
  state.limit = PAGE_SIZE;
  if (filter) filter.value = "all";
  list?.replaceChildren();
  setText("login-history-page", "—");
}

function render() {
  if (!root) return;
  applyCopy();
  if (filter) filter.value = state.result;

  const stats = state.data?.stats || {};
  setText("login-history-total", stats.total ?? 0);
  setText("login-history-success", stats.success ?? 0);
  setText("login-history-failure", stats.failure ?? 0);
  setText("login-history-locked", stats.locked ?? 0);
  renderList();
  renderPagination();
}

function renderList() {
  if (!list) return;
  list.replaceChildren();
  const rows = state.data?.items || [];
  if (!rows.length) {
    list.append(textNode("p", tr("noHistory"), "login-history-empty"));
    return;
  }
  for (const row of rows) list.append(renderEvent(row));
}

function renderEvent(row) {
  const article = node("article", `login-event login-event-${safeResult(row.result)}`);

  const head = node("div", "login-event-head");
  const identity = node("div", "login-event-identity");
  identity.append(
    resultBadge(row.result),
    textNode("strong", row.username || tr("unknown"), "login-event-user"),
  );
  const stamp = textNode("time", formatDateTime(row.created_at), "login-event-time", "ltr");
  if (row.created_at) stamp.dateTime = String(row.created_at);
  head.append(identity, stamp);

  const summary = node("div", "login-event-summary");
  summary.append(
    meta(tr("ip"), row.ip_address || tr("unknown"), "ltr"),
    meta(tr("location"), formatLocation(row) || tr("unknown")),
    meta(tr("reason"), reasonLabel(row.reason)),
  );

  const details = document.createElement("details");
  details.className = "login-event-details";
  const summaryControl = textNode("summary", tr("details"), "login-event-details-toggle");
  const grid = node("div", "login-event-details-grid");
  grid.append(
    detail(tr("userAgent"), row.user_agent || "—", "ltr"),
    detail(tr("cfRay"), row.cf_ray || "—", "ltr"),
    detail(tr("asn"), row.asn == null ? "—" : String(row.asn), "ltr"),
    detail(tr("timezone"), row.timezone || "—", "ltr"),
    detail(tr("sessionRef"), row.session_ref || "—", "ltr"),
    detail(tr("result"), resultLabel(row.result)),
  );
  details.append(summaryControl, grid);

  article.append(head, summary, details);
  return article;
}

function renderPagination() {
  const pagination = state.data?.pagination || {};
  const total = Math.max(0, Number(pagination.total) || 0);
  const offset = Math.max(0, Number(pagination.offset) || 0);
  const count = state.data?.items?.length || 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + count);
  setText(
    "login-history-page",
    tr("pageStatus")
      .replace("{from}", String(from))
      .replace("{to}", String(to))
      .replace("{total}", String(total)),
  );
  if (previous) previous.disabled = offset <= 0;
  if (next) next.disabled = !Boolean(pagination.has_more);
}

function resultBadge(value) {
  const result = safeResult(value);
  return textNode("span", resultLabel(result), `login-result-badge ${result}`);
}

function safeResult(value) {
  const result = String(value || "").trim().toLowerCase();
  return ["success", "failure", "locked"].includes(result) ? result : "failure";
}

function resultLabel(value) {
  const result = safeResult(value);
  return tr(result);
}

function reasonLabel(value) {
  const reason = String(value || "").trim();
  const key = `reason_${reason}`;
  return copy[language()]?.[key] || copy.en[key] || reason || tr("unknown");
}

function formatLocation(row) {
  return [row.city, row.region, row.country].filter(Boolean).join(" · ");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language() === "fa" ? "fa-IR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function meta(label, value, dir = "") {
  const item = node("div", "login-event-meta");
  item.append(
    textNode("span", label, "login-event-meta-label"),
    textNode("strong", value, "login-event-meta-value", dir),
  );
  return item;
}

function detail(label, value, dir = "") {
  const item = node("div", "login-event-detail");
  item.append(
    textNode("span", label, "login-event-detail-label"),
    textNode("code", value, "login-event-detail-value", dir),
  );
  return item;
}

function applyCopy() {
  root.querySelectorAll("[data-login-i18n]").forEach((element) => {
    element.textContent = tr(element.dataset.loginI18n);
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
