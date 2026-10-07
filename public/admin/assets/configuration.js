const copy = Object.freeze({
	fa: {
		title: "پیکربندی سیستم",
		intro: "تنظیمات Runtime، همه منابع بازار و Secretهای رمزنگاری‌شده را بدون redeploy مدیریت کنید.",
		reload: "بروزرسانی",
		loading: "در حال بارگذاری پیکربندی…",
		loadError: "بارگذاری پیکربندی ناموفق بود.",
		save: "ذخیره",
		reset: "پیش‌فرض",
		test: "تست",
		testDone: "تست منبع انجام شد.",
		saved: "تنظیمات ذخیره شد.",
		secretSaved: "Secret با موفقیت جایگزین شد.",
		source: "منبع مقدار",
		defaultValue: "مقدار پیش‌فرض",
		envKey: "ENV قدیمی",
		general: "عمومی",
		telegram: "Telegram",
		coingecko: "CoinGecko",
		providers: "منابع بازار",
		cloudflare: "Cloudflare / D1",
		secure: "Secure settings",
		secureIntro: "مقدار فعلی Secret هیچ‌وقت نمایش داده نمی‌شود. برای جایگزینی، Secret جدید و رمز فعلی Web Admin را وارد کنید.",
		configured: "تنظیم‌شده",
		missing: "تنظیم‌نشده",
		replace: "جایگزینی Secret",
		newSecret: "Secret جدید",
		currentPassword: "رمز فعلی Web Admin",
		confirmSecretReplace: "Secret فعلی جایگزین شود؟ مقدار قبلی دیگر از پنل قابل بازیابی نیست.",
		protected: "تنظیمات محافظت‌شده",
		protectedIntro: "این مقادیر فقط وضعیتشان نمایش داده می‌شود و از پنل قابل تغییر نیستند.",
		masterKey: "APP_MASTER_KEY",
		appName: "APP_NAME",
		appVersion: "APP_VERSION",
		readOnly: "فقط خواندنی",
		d1: "D1",
		env: "ENV",
		default: "Default",
		d1Invalid: "D1 نامعتبر",
		encryptedD1: "Encrypted D1",
		legacyEnv: "Legacy ENV",
		writeOnly: "Write-only",
	},
	en: {
		title: "System configuration",
		intro: "Manage runtime settings, every market provider and encrypted secrets without redeploying.",
		reload: "Refresh",
		loading: "Loading configuration…",
		loadError: "Configuration could not be loaded.",
		save: "Save",
		reset: "Default",
		test: "Test",
		testDone: "Source test completed.",
		saved: "Settings saved.",
		secretSaved: "Secret replaced successfully.",
		source: "Value source",
		defaultValue: "Default value",
		envKey: "Legacy ENV",
		general: "General",
		telegram: "Telegram",
		coingecko: "CoinGecko",
		providers: "Market providers",
		cloudflare: "Cloudflare / D1",
		secure: "Secure settings",
		secureIntro: "Current secret values are never returned. Enter a replacement and your current Web Admin password.",
		configured: "Configured",
		missing: "Missing",
		replace: "Replace secret",
		newSecret: "New secret",
		currentPassword: "Current Web Admin password",
		confirmSecretReplace: "Replace the current secret? The previous value cannot be recovered from this panel.",
		protected: "Protected settings",
		protectedIntro: "Only status/identity is shown. These values are not editable from Web Admin.",
		masterKey: "APP_MASTER_KEY",
		appName: "APP_NAME",
		appVersion: "APP_VERSION",
		readOnly: "Read-only",
		d1: "D1",
		env: "ENV",
		default: "Default",
		d1Invalid: "Invalid D1",
		encryptedD1: "Encrypted D1",
		legacyEnv: "Legacy ENV",
		writeOnly: "Write-only",
	},
});

const CATEGORY_ORDER = ["general", "telegram", "coingecko", "providers", "cloudflare"];
const state = { data: null };

const root = document.querySelector("#configuration-panel");
const runtimeRoot = document.querySelector("#configuration-runtime-groups");
const secureRoot = document.querySelector("#configuration-secure-list");
const protectedRoot = document.querySelector("#configuration-protected-list");
const reloadButton = document.querySelector("#configuration-reload");

reloadButton?.addEventListener("click", () => withBusy(reloadButton, load));

export const configurationView = Object.freeze({ load, render, reset });
window.DRDConfiguration = configurationView;

async function load() {
	renderLoading();
	try {
		const payload = await bridge().configurationSnapshot();
		state.data = payload.data || { runtime: { entries: [] }, secure: { entries: [] }, protected: {} };
		render();
	} catch (error) {
		state.data = null;
		renderLoadError(error);
		throw error;
	}
}

function reset() {
	state.data = null;
	runtimeRoot?.replaceChildren();
	secureRoot?.replaceChildren();
	protectedRoot?.replaceChildren();
}

function renderLoading() {
	applyCopy();
	runtimeRoot?.replaceChildren(textNode("p", tr("loading"), "configuration-empty"));
	secureRoot?.replaceChildren();
	protectedRoot?.replaceChildren();
}

function renderLoadError(error) {
	applyCopy();
	const message = String(error?.message || "").trim();
	runtimeRoot?.replaceChildren(
		textNode(
			"p",
			message ? `${tr("loadError")} ${message}` : tr("loadError"),
			"configuration-empty",
		),
	);
	secureRoot?.replaceChildren();
	protectedRoot?.replaceChildren();
}

function render() {
	if (!root) return;
	applyCopy();
	renderRuntime();
	renderSecure();
	renderProtected();
}

function renderRuntime() {
	if (!runtimeRoot) return;
	runtimeRoot.replaceChildren();
	const entries = state.data?.runtime?.entries || [];
	for (const category of CATEGORY_ORDER) {
		const items = entries.filter((entry) => entry.category === category);
		if (!items.length) continue;
		runtimeRoot.append(runtimeGroup(category, items));
	}
}

function runtimeGroup(category, entries) {
	const card = node("form", "panel-card configuration-group");
	card.dataset.category = category;
	card.noValidate = true;

	const heading = node("div", "card-heading");
	const headingText = node("div");
	headingText.append(
		textNode("h3", tr(category)),
		textNode("p", `${entries.length} setting(s)`, "configuration-muted"),
	);
	heading.append(headingText);
	card.append(heading);

	const grid = node("div", "configuration-field-grid");
	for (const entry of entries) grid.append(runtimeField(entry));
	card.append(grid);

	const actions = node("div", "configuration-actions");
	const save = textNode("button", tr("save"), "primary-button");
	save.type = "submit";
	actions.append(save);
	card.append(actions);

	card.addEventListener("submit", async (event) => {
		event.preventDefault();
		await withBusy(save, async () => {
			const values = {};
			for (const input of card.querySelectorAll("[data-config-key]")) {
				values[input.dataset.configKey] = inputValue(input);
			}
			const payload = await bridge().updateRuntimeConfiguration(values);
			state.data = payload.data;
			bridge().toast(tr("saved"), "success");
			render();
		});
	});

	return card;
}

function runtimeField(entry) {
	const wrap = node("div", "configuration-field");
	const label = node("label", "field configuration-field-main");
	label.append(textNode("span", settingLabel(entry.key)));

	let input;
	if (entry.type === "enum") {
		input = document.createElement("select");
		for (const option of entry.rules?.options || []) {
			const element = document.createElement("option");
			element.value = String(option);
			element.textContent = String(option);
			input.append(element);
		}
		input.value = String(entry.value ?? "");
	} else {
		input = document.createElement("input");
		input.type = entry.type === "integer" ? "number" : "text";
		if (entry.rules?.min != null) input.min = String(entry.rules.min);
		if (entry.rules?.max != null) input.max = String(entry.rules.max);
		if (entry.rules?.max_length != null) input.maxLength = Number(entry.rules.max_length);
		input.value = displayValue(entry.value);
	}
	input.dataset.configKey = entry.key;
	input.dataset.configType = entry.type;
	if (["url", "telegram_id", "telegram_handle"].includes(entry.type)) input.dir = "ltr";
	label.append(input);

	const meta = node("div", "configuration-field-meta");
	meta.append(
		badge(sourceLabel(entry.source), sourceKind(entry.source)),
		textNode("span", `${tr("envKey")}: ${entry.legacy_env_key || "—"}`, "configuration-muted", "ltr"),
	);

	const actions = node("div", "configuration-inline-actions");
	const reset = textNode("button", tr("reset"), "secondary-button compact-button");
	reset.type = "button";
	reset.addEventListener("click", () => {
		input.value = displayValue(entry.default_value);
	});

	actions.append(reset);
	const sourceName = providerSourceFromKey(entry.key);
	if (sourceName) {
		const test = textNode("button", tr("test"), "secondary-button compact-button");
		test.type = "button";
		test.addEventListener("click", () =>
			withBusy(test, async () => {
				await bridge().testConfiguredSource(sourceName);
				bridge().toast(tr("testDone"), "success");
			}),
		);
		actions.append(test);
	}

	wrap.append(label, meta, actions);
	return wrap;
}

function renderSecure() {
	if (!secureRoot) return;
	secureRoot.replaceChildren();
	for (const entry of state.data?.secure?.entries || []) {
		secureRoot.append(secureCard(entry));
	}
}

function secureCard(entry) {
	const card = node("form", "panel-card configuration-secret-card");
	card.noValidate = true;

	const head = node("div", "configuration-secret-head");
	const identity = node("div");
	identity.append(
		textNode("strong", settingLabel(entry.key)),
		textNode("div", entry.env_key || "—", "configuration-muted", "ltr"),
	);
	head.append(
		identity,
		badge(
			entry.configured ? tr("configured") : tr("missing"),
			entry.configured ? "success" : "warning",
		),
	);
	card.append(head);

	const secretLabel = node("label", "field");
	secretLabel.append(textNode("span", tr("newSecret")));
	const secret = document.createElement("input");
	secret.type = "password";
	secret.autocomplete = "new-password";
	secret.maxLength = 4096;
	secret.required = true;
	secret.dir = "ltr";
	secretLabel.append(secret);

	const passwordLabel = node("label", "field");
	passwordLabel.append(textNode("span", tr("currentPassword")));
	const password = document.createElement("input");
	password.type = "password";
	password.autocomplete = "current-password";
	password.maxLength = 128;
	password.required = true;
	passwordLabel.append(password);

	const actions = node("div", "configuration-actions");
	const submit = textNode("button", tr("replace"), "primary-button");
	submit.type = "submit";
	actions.append(submit);

	if (entry.key === "coingecko.api_key") {
		const test = textNode("button", tr("test"), "secondary-button");
		test.type = "button";
		test.addEventListener("click", () =>
			withBusy(test, async () => {
				await bridge().testConfiguredSource("coingecko");
				bridge().toast(tr("testDone"), "success");
			}),
		);
		actions.append(test);
	}

	card.append(secretLabel, passwordLabel, actions);

	card.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (!secret.value || !password.value) return;
		if (!confirm(tr("confirmSecretReplace"))) return;
		await withBusy(submit, async () => {
			await bridge().replaceSecureConfiguration(
				entry.key,
				secret.value,
				password.value,
			);
			secret.value = "";
			password.value = "";
			bridge().toast(tr("secretSaved"), "success");
			await load();
		});
	});

	return card;
}

function renderProtected() {
	if (!protectedRoot) return;
	protectedRoot.replaceChildren();
	const data = state.data?.protected || {};
	const rows = [
		[tr("appName"), data.app_name || "—"],
		[tr("appVersion"), data.app_version || "—"],
		[tr("masterKey"), data.app_master_key_configured ? tr("configured") : tr("missing")],
	];
	for (const [label, value] of rows) {
		const row = node("div", "configuration-protected-row");
		row.append(
			textNode("span", label),
			textNode("strong", value, "", "ltr"),
			badge(tr("readOnly"), "neutral"),
		);
		protectedRoot.append(row);
	}
}

function providerSourceFromKey(key) {
	const match = /^providers\.([a-z0-9_]+)_api_url$/.exec(String(key));
	return match ? match[1] : "";
}

function settingLabel(key) {
	const labels = {
		"general.bot_display_name": "Bot display name",
		"general.timezone": "Timezone",
		"telegram.owner_id": "Telegram owner ID",
		"telegram.channel_id": "Telegram channel ID",
		"telegram.channel_handle": "Telegram channel handle",
		"coingecko.plan": "CoinGecko plan",
		"coingecko.top_limit": "CoinGecko top limit",
		"coingecko.default_assets": "CoinGecko default assets",
		"coingecko.user_agent": "CoinGecko User-Agent",
		"cloudflare.account_id": "Cloudflare account ID",
		"cloudflare.d1_database_id": "Cloudflare D1 database ID",
		"cloudflare.d1_database_limit_mb": "D1 database limit (MB)",
		"telegram.bot_token": "Telegram bot token",
		"telegram.webhook_secret": "Telegram webhook secret",
		"coingecko.api_key": "CoinGecko API key",
		"cloudflare.api_token": "Cloudflare API token",
	};
	if (labels[key]) return labels[key];
	const provider = /^providers\.([a-z0-9_]+)_api_url$/.exec(String(key));
	if (provider) return `${provider[1].replaceAll("_", " ")} API URL`;
	return key;
}

function inputValue(input) {
	if (input.dataset.configType === "integer") return Number(input.value);
	return input.value;
}

function displayValue(value) {
	return Array.isArray(value) ? value.join(",") : String(value ?? "");
}

function sourceLabel(source) {
	return ({
		d1: tr("d1"),
		env: tr("env"),
		default: tr("default"),
		d1_invalid: tr("d1Invalid"),
		encrypted_d1: tr("encryptedD1"),
		legacy_env: tr("legacyEnv"),
		missing: tr("missing"),
	})[source] || String(source || "—");
}

function sourceKind(source) {
	if (["d1", "encrypted_d1"].includes(source)) return "success";
	if (source === "d1_invalid") return "danger";
	if (["env", "legacy_env"].includes(source)) return "warning";
	return "neutral";
}

function applyCopy() {
	if (!root) return;
	root.querySelectorAll("[data-config-i18n]").forEach((element) => {
		element.textContent = tr(element.dataset.configI18n);
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
		throw error;
	} finally {
		if (control) {
			control.disabled = false;
			control.setAttribute("aria-busy", "false");
		}
	}
}

function badge(label, kind = "neutral") {
	return textNode("span", label, `configuration-badge ${kind}`);
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
