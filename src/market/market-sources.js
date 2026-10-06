import { APP, USDT_SOURCE_PRIORITY } from "../config/app.js";
import {
	capitalize,
	errorMessage,
	failure,
	nullableNumber,
	sourceLabel,
	success,
} from "../utils/core.js";

/** Market source clients for USDT and Iranian gold. */
export class MarketSources {
	constructor(env, http, statuses, config = null, sourceSettings = null, resilience = null) {
		this.env = env;
		this.http = http;
		this.statuses = statuses;
		this.config = config;
		this.sourceSettings = sourceSettings;
		this.resilience = resilience;
	}

	async resolveUsdt() {
		const priority = this.sourceSettings
			? await this.sourceSettings.usdtPriority()
			: [...USDT_SOURCE_PRIORITY];
		let enabledCount = 0;
		for (let index = 0; index < priority.length; index += 1) {
			const source = priority[index];
			if (this.sourceSettings && !(await this.sourceSettings.isEnabled(source))) continue;
			enabledCount += 1;
			const result = await this[`check${capitalize(source)}`]();
			if (!result.skipped) await this.statuses.save(source, result);
			if (result.success) {
				return { ...result, source, sourceLabel: sourceLabel(source), fallbackLevel: index };
			}
		}
		return failure(enabledCount ? "All enabled USDT sources failed" : "No USDT sources enabled");
	}

	async checkAllUsdt() {
		const results = {};
		for (const source of ["wallex", "tabdeal", "exir"]) {
			if (this.sourceSettings && !(await this.sourceSettings.isEnabled(source))) {
				results[source] = failure("Source disabled", null, 0);
				continue;
			}
			results[source] = await this[`check${capitalize(source)}`]();
		}
		await this.statuses.saveMany(results);
		return results;
	}

	async checkWallex() {
		return this.#resilient("wallex", () => this.#timed("wallex", async () => {
			const url = this.config?.wallexApiUrl || this.env.WALLEX_API_URL || "https://api.wallex.ir/v1/markets";
			const response = await this.http.fetch(
				url,
				{ headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } },
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const documentedMarket = data?.result?.symbols?.USDTTMN;
			const legacyMarkets = data?.result?.markets;
			const legacyMarket = Array.isArray(legacyMarkets)
				? legacyMarkets.find(
					(item) => String(item.symbol || "").toUpperCase() === "USDTTMN",
				)
				: null;
			const price = nullableNumber(
				documentedMarket?.stats?.askPrice ??
					documentedMarket?.stats?.lastPrice ??
					documentedMarket?.price ??
					legacyMarket?.price,
			);
			return price && price > 0
				? success(price, response.status)
				: failure("Invalid Wallex response", response.status);
		}));
	}

	async checkTabdeal() {
		return this.#resilient("tabdeal", () => this.#timed("tabdeal", async () => {
			const url = this.config?.tabdealApiUrl || this.env.TABDEAL_API_URL || "https://api1.tabdeal.org/r/api/v1/depth?symbol=USDTIRT&limit=1";
			const response = await this.http.fetch(
				url,
				{ headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } },
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const price = nullableNumber(data?.asks?.[0]?.[0]);
			return price && price > 0
				? success(price, response.status)
				: failure("Invalid Tabdeal response", response.status);
		}));
	}

	async checkExir() {
		return this.#resilient("exir", () => this.#timed("exir", async () => {
			const url = this.config?.exirApiUrl || this.env.EXIR_API_URL || "https://api.exir.io/v2/orderbook?symbol=usdt-irt";
			const response = await this.http.fetch(
				url,
				{ headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } },
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const orderbook =
				data?.["usdt-irt"] ??
				data?.["USDT-IRT"] ??
				data;
			const price = nullableNumber(
				orderbook?.asks?.[0]?.[0] ??
					orderbook?.ask?.[0]?.price ??
					orderbook?.asks?.[0]?.price,
			);
			return price && price > 0
				? success(price, response.status)
				: failure("Invalid Exir response", response.status);
		}));
	}

	async checkWallGold() {
		const result = await this.#resilient("wallgold", () => this.#timed("wallgold", async () => {
			const url = this.config?.wallGoldApiUrl || this.env.WALLGOLD_API_URL || "https://api.wallgold.ir/api/v1/price?side=buy&symbol=GLD_18C_750TMN";
			const response = await this.http.fetch(
				url,
				{ headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } },
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const price = nullableNumber(data?.result?.price);
			return price && price > 0
				? success(price, response.status)
				: failure("Invalid WallGold response", response.status);
		}));
		if (!result.skipped) await this.statuses.save("wallgold", result);
		return result;
	}

	async #resilient(source, operation) {
		return this.resilience ? this.resilience.execute(source, operation) : operation();
	}

	async #timed(_source, operation) {
		const startedAt = Date.now();
		try {
			const result = await operation();
			return { ...result, latency: Date.now() - startedAt };
		} catch (error) {
			return failure(errorMessage(error), null, Date.now() - startedAt);
		}
	}
}
