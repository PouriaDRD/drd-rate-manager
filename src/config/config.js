import { APP } from "./app.js";

/** Runtime configuration facade backed by typed D1 settings plus legacy env fallback. */
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
		return this.#setting("general.timezone", String(this.env.TIMEZONE || "Asia/Tehran"));
	}

	get displayName() {
		return this.#setting("general.bot_display_name", String(this.env.BOT_DISPLAY_NAME || APP.displayName));
	}

	get channelId() {
		const value = this.#setting("telegram.channel_id", this.env.TELEGRAM_CHANNEL_ID || "");
		return value || null;
	}

	get channelHandle() {
		const value = String(this.#setting("telegram.channel_handle", this.env.TELEGRAM_CHANNEL_HANDLE || "")).trim();
		if (!value) return "";
		return value.startsWith("@") ? value : `@${value}`;
	}

	get ownerId() {
		return String(this.#setting("telegram.owner_id", this.env.TELEGRAM_OWNER_ID || "")).trim();
	}

	get coinGeckoPlan() {
		return String(this.#setting("coingecko.plan", this.env.COINGECKO_API_PLAN || "demo")).toLowerCase() === "pro"
			? "pro"
			: "demo";
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
		const raw = Number(this.#setting("coingecko.top_limit", this.env.COINGECKO_TOP_LIMIT || 20));
		return Number.isFinite(raw) ? Math.min(50, Math.max(10, Math.floor(raw))) : 20;
	}

	get defaultCoinGeckoAssets() {
		const configured = this.#setting(
			"coingecko.default_assets",
			String(this.env.COINGECKO_DEFAULT_ASSETS || "bitcoin,ethereum,binancecoin,ripple,solana,tron")
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
		);
		return Array.isArray(configured)
			? configured
			: String(configured || "")
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
	}

	get coinGeckoUserAgent() {
		const legacy = String(this.env.COINGECKO_USER_AGENT || "").trim();
		if (legacy) return legacy;
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
		return this.#setting("providers.wallex_api_url", this.env.WALLEX_API_URL || "https://api.wallex.ir/hector/web/v1/markets");
	}

	get tabdealApiUrl() {
		return this.#setting("providers.tabdeal_api_url", this.env.TABDEAL_API_URL || "https://api1.tabdeal.org/r/api/v1/depth?symbol=USDTIRT&limit=1");
	}

	get exirApiUrl() {
		return this.#setting("providers.exir_api_url", this.env.EXIR_API_URL || "https://api.exir.io/v2/orderbook?symbol=usdt-irt");
	}

	get wallGoldApiUrl() {
		return this.#setting("providers.wallgold_api_url", this.env.WALLGOLD_API_URL || "https://api.wallgold.ir/api/v1/price?side=buy&symbol=GLD_18C_750TMN");
	}

	get cloudflareAccountId() {
		return String(this.#setting("cloudflare.account_id", this.env.CLOUDFLARE_ACCOUNT_ID || "")).trim();
	}

	get cloudflareD1DatabaseId() {
		return String(this.#setting("cloudflare.d1_database_id", this.env.CLOUDFLARE_D1_DATABASE_ID || "")).trim();
	}

	get d1DatabaseLimitMb() {
		const raw = Number(this.#setting("cloudflare.d1_database_limit_mb", this.env.D1_DATABASE_LIMIT_MB || 500));
		return Number.isFinite(raw) && raw > 0 ? raw : 500;
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

	#setting(key, fallback) {
		if (!this.settingsService) return fallback;
		try {
			return this.settingsService.get(key);
		} catch {
			return fallback;
		}
	}
}
