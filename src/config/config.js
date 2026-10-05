import { APP } from "./app.js";

/**
 * Deployment configuration facade.
 *
 * Phase 1 intentionally preserves the current environment-backed behavior.
 * Moving runtime settings from env to D1 belongs to Phase 3.
 */
export class Config {
	constructor(env) {
		this.env = env;
	}

	get version() {
		return String(this.env.APP_VERSION || APP.version);
	}

	get timezone() {
		return String(this.env.TIMEZONE || "Asia/Tehran");
	}

	get displayName() {
		return String(this.env.BOT_DISPLAY_NAME || APP.displayName);
	}

	get channelId() {
		return this.env.TELEGRAM_CHANNEL_ID || null;
	}

	get channelHandle() {
		const value = String(this.env.TELEGRAM_CHANNEL_HANDLE || "").trim();
		if (!value) return "";
		return value.startsWith("@") ? value : `@${value}`;
	}

	get ownerId() {
		return String(this.env.TELEGRAM_OWNER_ID || "").trim();
	}

	get coinGeckoPlan() {
		return String(this.env.COINGECKO_API_PLAN || "demo").toLowerCase() === "pro"
			? "pro"
			: "demo";
	}

	get coinGeckoBaseUrl() {
		return this.coinGeckoPlan === "pro"
			? "https://pro-api.coingecko.com/api/v3"
			: "https://api.coingecko.com/api/v3";
	}

	coinGeckoHeaders() {
		const headers = {
			Accept: "application/json",
			"User-Agent": String(
				this.env.COINGECKO_USER_AGENT ||
					`DRD-Rate-Manager/${this.version} (+https://t.me/${this.channelHandle.replace(/^@/, "") || "DRDrate"})`,
			),
		};
		if (this.env.COINGECKO_API_KEY) {
			headers[this.coinGeckoPlan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] =
				this.env.COINGECKO_API_KEY;
		}
		return headers;
	}

	get coinGeckoTopLimit() {
		const raw = Number(this.env.COINGECKO_TOP_LIMIT || 20);
		return Number.isFinite(raw) ? Math.min(50, Math.max(10, Math.floor(raw))) : 20;
	}

	get defaultCoinGeckoAssets() {
		const configured = String(this.env.COINGECKO_DEFAULT_ASSETS || "")
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		return configured.length
			? configured
			: ["bitcoin", "ethereum", "binancecoin", "ripple", "solana", "tron"];
	}
}
