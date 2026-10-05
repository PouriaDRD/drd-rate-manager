export const SECURE_SETTINGS_VERSION = 1;

export const SECURE_SETTING_DEFINITIONS = Object.freeze({
	"telegram.bot_token": Object.freeze({ envKey: "TELEGRAM_BOT_TOKEN" }),
	"telegram.webhook_secret": Object.freeze({ envKey: "TELEGRAM_WEBHOOK_SECRET" }),
	"coingecko.api_key": Object.freeze({ envKey: "COINGECKO_API_KEY" }),
	"cloudflare.api_token": Object.freeze({ envKey: "CLOUDFLARE_API_TOKEN" }),
});

export const SECURE_SETTING_KEYS = Object.freeze(Object.keys(SECURE_SETTING_DEFINITIONS));

export const LEGACY_SECURE_ENV_KEYS = Object.freeze(
	Object.values(SECURE_SETTING_DEFINITIONS).map((definition) => definition.envKey),
);

export const SECURE_SETTING_ENV_MAP = Object.freeze(
	Object.fromEntries(
		Object.entries(SECURE_SETTING_DEFINITIONS).map(([key, definition]) => [definition.envKey, key]),
	),
);

export function isManagedSecureSetting(key) {
	return Object.prototype.hasOwnProperty.call(SECURE_SETTING_DEFINITIONS, key);
}

export function legacySecureSettingValue(env, key) {
	const definition = SECURE_SETTING_DEFINITIONS[key];
	if (!definition) throw new Error(`Unknown secure setting: ${key}`);
	return String(env?.[definition.envKey] ?? "");
}
