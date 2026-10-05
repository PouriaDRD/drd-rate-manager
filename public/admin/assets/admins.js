const copy = Object.freeze({
  fa: {
    title: "مدیریت ادمین‌ها",
    intro: "دسترسی تلگرام ادمین‌ها را از یک منبع مشترک مدیریت کنید.",
    total: "کل دسترسی‌ها",
    active: "ادمین فعال",
    inactive: "ادمین غیرفعال",
    addTitle: "افزودن ادمین",
    addHelp: "آیدی عددی Telegram را وارد کنید. فقط مالک سیستم قابل مدیریت نیست.",
    telegramId: "آیدی عددی Telegram",
    add: "افزودن",
    listTitle: "دسترسی‌ها",
    search: "جستجو بر اساس نام، نام کاربری یا آیدی…",
    reload: "بروزرسانی",
    owner: "مالک",
    admin: "ادمین",
    enabled: "فعال",
    disabled: "غیرفعال",
    protected: "محافظت‌شده",
    enable: "فعال‌سازی",
    disable: "غیرفعال‌سازی",
    remove: "حذف",
    lastActivity: "آخرین فعالیت",
    createdAt: "ایجاد",
    addedBy: "افزوده‌شده توسط",
    noActivity: "بدون فعالیت ثبت‌شده",
    noAdmins: "ادمینی برای نمایش وجود ندارد.",
    addDone: "ادمین اضافه شد.",
    enabledDone: "ادمین فعال شد.",
    disabledDone: "ادمین غیرفعال شد.",
    removedDone: "ادمین حذف شد.",
    disableConfirm: "این ادمین غیرفعال شود؟ تا فعال‌سازی مجدد به ربات دسترسی نخواهد داشت.",
    removeConfirm: "این ادمین برای همیشه از لیست دسترسی حذف شود؟",
    invalidId: "یک آیدی عددی معتبر Telegram وارد کنید.",
    ownerHint: "مالک از تنظیمات سیستم می‌آید و از این صفحه قابل حذف یا غیرفعال‌سازی نیست.",
  },
  en: {
    title: "Admin management",
    intro: "Manage Telegram administrator access through the shared admin service.",
    total: "Total access",
    active: "Active admins",
    inactive: "Inactive admins",
    addTitle: "Add admin",
    addHelp: "Enter a numeric Telegram user ID. The configured owner is immutable.",
    telegramId: "Telegram numeric ID",
    add: "Add admin",
    listTitle: "Access list",
    search: "Search by name, username or ID…",
    reload: "Refresh",
    owner: "Owner",
    admin: "Admin",
    enabled: "Enabled",
    disabled: "Disabled",
    protected: "Protected",
    enable: "Enable",
    disable: "Disable",
    remove: "Remove",
    lastActivity: "Last activity",
    createdAt: "Created",
    addedBy: "Added by",
    noActivity: "No recorded activity",
    noAdmins: "No administrators to display.",
    addDone: "Administrator added.",
    enabledDone: "Administrator enabled.",
    disabledDone: "Administrator disabled.",
    removedDone: "Administrator removed.",
    disableConfirm: "Disable this administrator? They will lose bot access until re-enabled.",
    removeConfirm: "Permanently remove this administrator from the access list?",
    invalidId: "Enter a valid numeric Telegram user ID.",
    ownerHint: "The owner comes from system configuration and cannot be removed or disabled here.",
  },
});

const state = {
  data: null,
  query: "",
};

const root = document.querySelector("#admins-view");
const form = document.querySelector("#admin-add-form");
const input = document.querySelector("#admin-add-id");
const search = document.querySelector("#admin-search");
const list = document.querySelector("#admins-list");
const reload = document.querySelector("#admins-reload");

form?.addEventListener("submit", addAdmin);
search?.addEventListener("input", () => {
  state.query = String(search.value || "").trim().toLowerCase();
  renderList();
});
reload?.addEventListener("click", () => withBusy(reload, load));

window.DRDAdmins = Object.freeze({
  load,
  render,
  reset,
});

async function load() {
  const shell = bridge();
  const payload = await shell.listAdmins();
  state.data = payload.data || { admins: [], stats: {}, capabilities: {} };
  render();
}

function reset() {
  state.data = null;
  state.query = "";
  if (search) search.value = "";
  list?.replaceChildren();
}

function render() {
  if (!root) return;
  applyCopy();
  const data = state.data || {};
  setText("admins-total", data.stats?.total ?? 0);
  setText("admins-active", data.stats?.active_admins ?? 0);
  setText("admins-inactive", data.stats?.inactive_admins ?? 0);
  renderList();
}

function renderList() {
  if (!list) return;
  list.replaceChildren();
  const admins = (state.data?.admins || []).filter(matchesQuery);
  if (!admins.length) {
    list.append(textNode("p", tr("noAdmins"), "admins-empty"));
    return;
  }

  for (const admin of admins) {
    list.append(renderAdmin(admin));
  }
}

function renderAdmin(admin) {
  const card = node("article", `admin-access-card${admin.role === "owner" ? " is-owner" : ""}`);

  const identity = node("div", "admin-identity");
  const avatar = textNode(
    "span",
    initials(admin.display_name || admin.username || admin.user_id),
    "admin-avatar",
  );
  const copyWrap = node("div", "admin-identity-copy");
  const titleRow = node("div", "admin-title-row");
  titleRow.append(
    textNode("strong", admin.role === "owner" ? tr("owner") : (admin.display_name || admin.user_id)),
    badge(admin.role === "owner" ? tr("owner") : tr("admin"), admin.role),
    badge(admin.active ? tr("enabled") : tr("disabled"), admin.active ? "success" : "muted"),
  );
  if (admin.immutable) titleRow.append(badge(tr("protected"), "protected"));

  const handle = admin.username ? `@${admin.username}` : "—";
  copyWrap.append(
    titleRow,
    textNode("span", `${handle} · ${admin.user_id}`, "admin-subline", "ltr"),
  );
  identity.append(avatar, copyWrap);

  const meta = node("div", "admin-meta-grid");
  meta.append(
    metaItem(tr("lastActivity"), admin.last_activity_at ? formatDateTime(admin.last_activity_at) : tr("noActivity")),
    metaItem(tr("createdAt"), admin.created_at ? formatDateTime(admin.created_at) : "—"),
    metaItem(tr("addedBy"), admin.added_by || "—", "ltr"),
  );

  const actions = node("div", "admin-actions");
  if (admin.immutable) {
    actions.append(textNode("span", tr("ownerHint"), "admin-owner-note"));
  } else if (state.data?.capabilities?.can_manage) {
    const statusButton = actionButton(
      admin.active ? tr("disable") : tr("enable"),
      admin.active ? "secondary-button compact-button" : "primary-button compact-button",
      async (button) => {
        if (admin.active && !confirm(tr("disableConfirm"))) return;
        await withBusy(button, async () => {
          await bridge().setAdminEnabled(admin.user_id, !admin.active);
          bridge().toast(admin.active ? tr("disabledDone") : tr("enabledDone"), "success");
          await load();
        });
      },
    );
    const removeButton = actionButton(
      tr("remove"),
      "danger-button compact-button",
      async (button) => {
        if (!confirm(tr("removeConfirm"))) return;
        await withBusy(button, async () => {
          await bridge().removeAdmin(admin.user_id);
          bridge().toast(tr("removedDone"), "success");
          await load();
        });
      },
    );
    actions.append(statusButton, removeButton);
  }

  card.append(identity, meta, actions);
  return card;
}

async function addAdmin(event) {
  event.preventDefault();
  const submit = event.submitter;
  const userId = normalizeDigits(String(input?.value || "").trim());
  if (!/^\d{5,20}$/.test(userId)) {
    bridge().toast(tr("invalidId"), "error");
    input?.focus();
    return;
  }

  await withBusy(submit, async () => {
    await bridge().addAdmin(userId);
    if (input) input.value = "";
    bridge().toast(tr("addDone"), "success");
    await load();
  });
}

function matchesQuery(admin) {
  if (!state.query) return true;
  return [
    admin.display_name,
    admin.username,
    admin.user_id,
    admin.role,
  ].some((value) => String(value || "").toLowerCase().includes(state.query));
}

function applyCopy() {
  root.querySelectorAll("[data-admin-i18n]").forEach((element) => {
    element.textContent = tr(element.dataset.adminI18n);
  });
  root.querySelectorAll("[data-admin-i18n-placeholder]").forEach((element) => {
    element.placeholder = tr(element.dataset.adminI18nPlaceholder);
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

function normalizeDigits(value) {
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function initials(value) {
  const clean = String(value || "A").trim();
  return clean.slice(0, 2).toUpperCase();
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language() === "fa" ? "fa-IR" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function metaItem(label, value, dir = "") {
  const item = node("div", "admin-meta-item");
  item.append(
    textNode("span", label, "admin-meta-label"),
    textNode("strong", value, "", dir),
  );
  return item;
}

function badge(label, kind) {
  return textNode("span", label, `admin-badge ${kind || ""}`.trim());
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
