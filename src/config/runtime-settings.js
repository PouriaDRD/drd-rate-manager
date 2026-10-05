import { APP } from "./app.js";

export const RUNTIME_SETTINGS_VERSION = 1;

const DEFAULT_ASSETS = "bitcoin,ethereum,binancecoin,ripple,solana,tron";

export const RUNTIME_SETTING_DEFINITIONS = Object.freeze([
	setting("general.bot_display_name", "general", "string", APP.displayName, "BOT_DISPLAY_NAME", {
		minLength: 1,
		maxLength: 80,
	}),
	setting("general.timezone", "general", "timezone", "Asia/Tehran", "TIMEZONE"),
	setting("telegram.owner_id", "telegram", "telegram_id", "", "TELEGRAM_OWNER_ID"),
	setting("telegram.channel_id", "telegram", "string", "", "TELEGRAM_CHANNEL_ID", {
		maxLength: 128,
	}),
	setting("telegram.channel_handle", "telegram", "telegram_handle", "", "TELEGRAM_CHANNEL_HANDLE"),
	setting("coingecko.plan", "coingecko", "enum", "demo", "COINGECKO_API_PLAN", {
		options: ["demo", "pro"],
	}),
	setting("coingecko.top_limit", "coingecko", "integer", 20, "COINGECKO_TOP_LIMIT", {
		min: 10,
		max: 50,
	}),
	setting("coingecko.default_assets", "coingecko", "csv", DEFAULT_ASSETS, "COINGECKO_DEFAULT_ASSETS"),
	setting(
		"providers.wallex_api_url",
		"providers",
		"url",
		"https://api.wallex.ir/hector/web/v1/markets",
		"WALLEX_API_URL",
	),
	setting(
		"providers.tabdeal_api_url",
		"providers",
		"url",
		"https://api1.tabdeal.org/r/api/v1/depth?symbol=USDTIRT&limit=1",
		"TABDEAL_API_URL",
	),
	setting(
		"providers.exir_api_url",
		"providers",
		"url",
		"https://api.exir.io/v2/orderbook?symbol=usdt-irt",
		"EXIR_API_URL",
	),
	setting(
		"providers.wallgold_api_url",
		"providers",
		"url",
		"https://api.wallgold.ir/api/v1/price?side=buy&symbol=GLD_18C_750TMN",
		"WALLGOLD_API_URL",
	),
	setting("cloudflare.account_id", "cloudflare", "string", "", "CLOUDFLARE_ACCOUNT_ID", {
		maxLength: 128,
	}),
	setting("cloudflare.d1_database_id", "cloudflare", "string", "", "CLOUDFLARE_D1_DATABASE_ID", {
		maxLength: 128,
	}),
	setting("cloudflare.d1_database_limit_mb", "cloudflare", "integer", 500, "D1_DATABASE_LIMIT_MB", {
		min: 1,
		max: 1_000_000,
	}),
]);

export const RUNTIME_SETTING_MAP = new Map(
	RUNTIME_SETTING_DEFINITIONS.map((definition) => [definition.key, definition]),
);

function setting(key, category, type, defaultValue, legacyEnvKey, rules = {}) {
	return Object.freeze({ key, category, type, defaultValue, legacyEnvKey, ...rules });
}

export function runtimeSettingSeedValues(env = {}) {
	return Object.fromEntries(
		RUNTIME_SETTING_DEFINITIONS.map((definition) => [
			definition.key,
			serializeRuntimeSetting(definition, safeFallbackValue(env, definition)),
		]),
	);
}

export function resolveRuntimeSettingFallback(env, definition) {
	return normalizeRuntimeSetting(definition, safeFallbackValue(env, definition));
}

function safeFallbackValue(env, definition) {
	const candidate = legacyValue(env, definition);
	try {
		return normalizeRuntimeSetting(definition, candidate);
	} catch {
		return normalizeRuntimeSetting(definition, definition.defaultValue);
	}
}

function legacyValue(env, definition) {
	const raw = definition.legacyEnvKey ? env?.[definition.legacyEnvKey] : undefined;
	if (raw === undefined || raw === null || String(raw).trim() === "") return definition.defaultValue;
	return raw;
}

export function normalizeRuntimeSetting(definitionOrKey, value) {
	const definition = typeof definitionOrKey === "string"
		? RUNTIME_SETTING_MAP.get(definitionOrKey)
		: definitionOrKey;
	if (!definition) throw new Error(`Unknown runtime setting: ${String(definitionOrKey)}`);

	switch (definition.type) {
		case "string":
			return normalizeString(definition, value);
		case "timezone":
			return normalizeTimezone(value);
		case "telegram_id":
			return normalizeTelegramId(value);
		case "telegram_handle":
			return normalizeTelegramHandle(value);
		case "enum":
			return normalizeEnum(definition, value);
		case "integer":
			return normalizeInteger(definition, value);
		case "csv":
			return normalizeCsv(value);
		case "url":
			return normalizeUrl(value);
		default:
			throw new Error(`Unsupported runtime setting type: ${definition.type}`);
	}
}

export function serializeRuntimeSetting(definitionOrKey, value) {
	const normalized = normalizeRuntimeSetting(definitionOrKey, value);
	return Array.isArray(normalized) ? normalized.join(",") : String(normalized);
}

function normalizeString(definition, value) {
	const text = String(value ?? "").trim();
	if (definition.minLength != null && text.length < definition.minLength) {
		throw new Error(`${definition.key} is too short`);
	}
	if (definition.maxLength != null && text.length > definition.maxLength) {
		throw new Error(`${definition.key} is too long`);
	}
	return text;
}

function normalizeTimezone(value) {
	const timezone = String(value ?? "").trim();
	if (!timezone) throw new Error("Timezone is required");
	try {
		new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
	} catch {
		throw new Error(`Invalid timezone: ${timezone}`);
	}
	return timezone;
}

function normalizeTelegramId(value) {
	const text = String(value ?? "").trim();
	if (!text) return "";
	if (!/^-?\d{5,20}$/.test(text)) throw new Error("Invalid Telegram owner ID");
	return text;
}

function normalizeTelegramHandle(value) {
	const text = String(value ?? "").trim();
	if (!text) return "";
	const handle = text.startsWith("@") ? text : `@${text}`;
	if (!/^@[A-Za-z0-9_]{5,32}$/.test(handle)) throw new Error("Invalid Telegram channel handle");
	return handle;
}

function normalizeEnum(definition, value) {
	const normalized = String(value ?? "").trim().toLowerCase();
	if (!definition.options?.includes(normalized)) {
		throw new Error(`Invalid ${definition.key}: ${normalized}`);
	}
	return normalized;
}

function normalizeInteger(definition, value) {
	const number = Number(value);
	if (!Number.isInteger(number)) throw new Error(`${definition.key} must be an integer`);
	if (definition.min != null && number < definition.min) throw new Error(`${definition.key} is below minimum`);
	if (definition.max != null && number > definition.max) throw new Error(`${definition.key} is above maximum`);
	return number;
}

function normalizeCsv(value) {
	const items = (Array.isArray(value) ? value : String(value ?? "").split(","))
		.map((item) => String(item).trim().toLowerCase())
		.filter(Boolean);
	const unique = [...new Set(items)];
	if (!unique.length) throw new Error("At least one CoinGecko asset is required");
	for (const item of unique) {
		if (!/^[a-z0-9-]+$/.test(item)) throw new Error(`Invalid CoinGecko asset: ${item}`);
	}
	return unique;
}

function normalizeUrl(value) {
	const text = String(value ?? "").trim();
	let url;
	try {
		url = new URL(text);
	} catch {
		throw new Error(`Invalid URL: ${text}`);
	}
	if (!["http:", "https:"].includes(url.protocol)) throw new Error(`Unsupported URL protocol: ${url.protocol}`);
	return url.toString();
}
