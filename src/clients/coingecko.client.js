import { failure, nullableNumber } from "../utils/core.js";

/**
 * CoinGecko client.
 * A market refresh performs exactly one CoinGecko request for selected
 * cryptocurrencies and the global metal proxy assets.
 */
export class CoinGeckoClient {
	constructor(env, config, http, resilience = null) {
		this.env = env;
		this.config = config;
		this.http = http;
		this.resilience = resilience;
	}

	async fetchMarketBundle(enabledAssets) {
		return this.#resilient(async () => {
			if (!this.env.COINGECKO_API_KEY) return failure("COINGECKO_API_KEY missing");
			const ids = [...new Set([
				...enabledAssets.map((item) => item.coin_id),
				"tether-gold",
				"kinesis-silver",
			])];
			const endpoint = `${this.config.coinGeckoBaseUrl}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
			const startedAt = Date.now();
			try {
				const response = await this.http.fetch(
					endpoint,
					{ headers: this.config.coinGeckoHeaders() },
					8000,
				);
				const latency = Date.now() - startedAt;
				if (!response.ok) {
					return failure(await this.http.sourceError(response), response.status, latency);
				}
				const data = await response.json();
				if (!Array.isArray(data)) {
					return failure("Invalid CoinGecko response", response.status, latency);
				}
				const map = new Map(data.map((item) => [String(item.id), item]));
				const crypto = enabledAssets.map((stored) => {
					const live = map.get(stored.coin_id);
					return {
						id: stored.coin_id,
						symbol: String(live?.symbol || stored.symbol || "").toUpperCase(),
						name: String(live?.name || stored.name || stored.coin_id),
						price: nullableNumber(live?.current_price),
						change24h: nullableNumber(live?.price_change_percentage_24h),
						marketCapRank: nullableNumber(live?.market_cap_rank ?? stored.market_cap_rank),
					};
				});
				return {
					success: true,
					status: response.status,
					latency,
					crypto,
					gold: nullableNumber(map.get("tether-gold")?.current_price),
					silver: nullableNumber(map.get("kinesis-silver")?.current_price),
				};
			} catch (error) {
				return failure(error instanceof Error ? error.message : String(error), null, Date.now() - startedAt);
			}
		});
	}

	async fetchTopAssets() {
		return this.#resilient(async () => {
			if (!this.env.COINGECKO_API_KEY) return failure("COINGECKO_API_KEY missing");
			const endpoint = `${this.config.coinGeckoBaseUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${this.config.coinGeckoTopLimit}&page=1&sparkline=false&price_change_percentage=24h`;
			const startedAt = Date.now();
			try {
				const response = await this.http.fetch(
					endpoint,
					{ headers: this.config.coinGeckoHeaders() },
					8000,
				);
				const latency = Date.now() - startedAt;
				if (!response.ok) {
					return failure(await this.http.sourceError(response), response.status, latency);
				}
				const data = await response.json();
				if (!Array.isArray(data)) {
					return failure("Invalid CoinGecko response", response.status, latency);
				}
				return {
					success: true,
					status: response.status,
					latency,
					assets: data.map((item) => ({
						id: String(item.id),
						symbol: String(item.symbol || "").toUpperCase(),
						name: String(item.name || item.id),
						marketCapRank: nullableNumber(item.market_cap_rank),
					})),
				};
			} catch (error) {
				return failure(error instanceof Error ? error.message : String(error), null, Date.now() - startedAt);
			}
		});
	}

	async #resilient(operation) {
		return this.resilience ? this.resilience.execute("coingecko", operation) : operation();
	}
}
