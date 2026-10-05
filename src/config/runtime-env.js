const ENV_SECRET_MAP = Object.freeze({
	TELEGRAM_BOT_TOKEN: "telegram.bot_token",
	TELEGRAM_WEBHOOK_SECRET: "telegram.webhook_secret",
	COINGECKO_API_KEY: "coingecko.api_key",
	CLOUDFLARE_API_TOKEN: "cloudflare.api_token",
});

/**
 * Provides backward-compatible env access while sourcing managed secrets from
 * encrypted D1 after SecureSettingsService initialization.
 */
export function createRuntimeEnv(env, secureSettingsService) {
	return new Proxy(env, {
		get(target, property) {
			const secureKey = typeof property === "string" ? ENV_SECRET_MAP[property] : null;
			if (secureKey) return secureSettingsService.get(secureKey);
			return target[property];
		},
	});
}
