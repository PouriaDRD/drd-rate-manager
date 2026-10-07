import { APP } from "./app.js";
import {
	RUNTIME_SETTING_MAP,
	resolveConfigCompatibilitySetting,
	resolveRuntimeSettingFallback,
} from "./runtime-settings.js";

/**
 * Runtime configuration facade.
 *
 * Managed non-secret values resolve through SettingsService, whose source
 * priority is D1 -> legacy ENV -> code default. If Config is constructed
 * without SettingsService (bootstrap/tests), it uses the same runtime-setting
 * catalog directly instead of duplicating fallback rules here.
 *
 * Managed secrets are exposed through the runtime env proxy and therefore
 * resolve from encrypted D1 after SecureSettingsService initialization.
 */
export class Config {
	constructor(env, settingsService = null) {
		this.env = env;
		this.settingsService = settingsService;
	}

	async refresh(options = {}) {
		if (!this.settingsService) return null;
		return this.settingsService.refresh(options);
	}

	get appName() {
		return String(this.env.APP_NAME || APP.name);
	}

	get version() {
		return String(this.env.APP_VERSION || APP.version);
	}

	get timezone() {
		return this.#setting("general.timezone");
	}

	get displayName() {
		return this.#setting("general.bot_display_name");
	}

	get channelId() {
		const value = this.#setting("telegram.channel_id");
		return value || null;
	}

	get channelHandle() {
		return String(this.#setting("telegram.channel_handle") || "").trim();
	}

	get ownerId() {
		return String(this.#setting("telegram.owner_id") || "").trim();
	}

	get coinGeckoPlan() {
		return this.#setting("coingecko.plan") === "pro" ? "pro" : "demo";
	}

	get coinGeckoBaseUrl() {
		return this.coinGeckoPlan === "pro"
			? "https://pro-api.coingecko.com/api/v3"
			: "https://api.coingecko.com/api/v3";
	}

	get coinGeckoApiKey() {
		return String(this.env.COINGECKO_API_KEY || "").trim();
	}

	get coinGeckoTopLimit() {
		return this.#setting("coingecko.top_limit");
	}

	get defaultCoinGeckoAssets() {
		const configured = this.#setting("coingecko.default_assets");
		return Array.isArray(configured) ? configured : [];
	}

	get coinGeckoUserAgent() {
		const configured = String(this.#setting("coingecko.user_agent") || "").trim();
		if (configured) return configured;
		return `DRD-Rate-Manager/${this.version} (+https://t.me/${this.channelHandle.replace(/^@/, "") || "DRDrate"})`;
	}

	coinGeckoHeaders() {
		const headers = {
			Accept: "application/json",
			"User-Agent": this.coinGeckoUserAgent,
		};
		if (this.coinGeckoApiKey) {
			headers[this.coinGeckoPlan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = this.coinGeckoApiKey;
		}
		return headers;
	}

	get wallexApiUrl() {
		return this.#setting("providers.wallex_api_url");
	}

	get tabdealApiUrl() {
		return this.#setting("providers.tabdeal_api_url");
	}

	get exirApiUrl() {
		return this.#setting("providers.exir_api_url");
	}

	get wallGoldApiUrl() {
		return this.#setting("providers.wallgold_api_url");
	}

	get bitpinApiUrl() {
		return this.#setting("providers.bitpin_api_url");
	}

	get nobitexApiUrl() {
		return this.#setting("providers.nobitex_api_url");
	}

	get ompfinexApiUrl() {
		return this.#setting("providers.ompfinex_api_url");
	}

	get ramzinexApiUrl() {
		return this.#setting("providers.ramzinex_api_url");
	}

	get technoGoldApiUrl() {
		return this.#setting("providers.technogold_api_url");
	}

	get melliGoldApiUrl() {
		return this.#setting("providers.melligold_api_url");
	}

	get talaseaApiUrl() {
		return this.#setting("providers.talasea_api_url");
	}

	get milliApiUrl() {
		return this.#setting("providers.milli_api_url");
	}

	get geramiApiUrl() {
		return this.#setting("providers.gerami_api_url");
	}

	get cloudflareAccountId() {
		return String(this.#setting("cloudflare.account_id") || "").trim();
	}

	get cloudflareD1DatabaseId() {
		return String(this.#setting("cloudflare.d1_database_id") || "").trim();
	}

	get d1DatabaseLimitMb() {
		return this.#setting("cloudflare.d1_database_limit_mb");
	}

	get telegramBotToken() {
		return String(this.env.TELEGRAM_BOT_TOKEN || "").trim();
	}

	get telegramWebhookSecret() {
		return String(this.env.TELEGRAM_WEBHOOK_SECRET || "");
	}

	get cloudflareApiToken() {
		return String(this.env.CLOUDFLARE_API_TOKEN || "").trim();
	}

	#setting(key) {
		const definition = RUNTIME_SETTING_MAP.get(key);
		if (!definition) throw new Error(`Unknown runtime setting: ${key}`);
		if (!this.settingsService) return resolveConfigCompatibilitySetting(this.env, definition);
		try {
			return this.settingsService.get(key);
		} catch {
			return resolveRuntimeSettingFallback(this.env, definition);
		}
	}
}
