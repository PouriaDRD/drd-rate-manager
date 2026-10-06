import { APP, GOLD_SOURCE_NAMES, USDT_SOURCE_PRIORITY } from "../config/app.js";
import {
	capitalize,
	errorMessage,
	failure,
	nullableNumber,
	sourceLabel,
	success,
} from "../utils/core.js";

const GOLD_OUTLIER_RATIO = 0.03;

function median(values) {
	const sorted = values
		.map(Number)
		.filter((value) => Number.isFinite(value) && value > 0)
		.sort((a, b) => a - b);
	if (!sorted.length) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

export function resolveGoldConsensus(results = {}) {
	const healthy = GOLD_SOURCE_NAMES
		.map((name) => ({ name, result: results[name] }))
		.filter(({ result }) => result?.success && Number(result.price) > 0);
	if (!healthy.length) return failure("All enabled gold sources failed");

	const center = median(healthy.map(({ result }) => result.price));
	let accepted = healthy;
	let rejected = [];
	if (healthy.length >= 3 && center) {
		const inliers = healthy.filter(
			({ result }) => Math.abs(Number(result.price) - center) / center <= GOLD_OUTLIER_RATIO,
		);
		if (inliers.length >= 2) {
			accepted = inliers;
			rejected = healthy.filter(
				(item) => !inliers.some((candidate) => candidate.name === item.name),
			);
		}
	}
	const price = Math.round(median(accepted.map(({ result }) => result.price)));
	return {
		...success(price, 200),
		source: "gold-consensus",
		sourceLabel: "Gold Consensus",
		contributors: accepted.map(({ name }) => name),
		rejected: rejected.map(({ name }) => name),
		sampleCount: accepted.length,
	};
}

const GOLD_METHODS = Object.freeze({
	wallgold: "checkWallGold",
	technogold: "checkTechnoGold",
	melligold: "checkMelliGold",
	talasea: "checkTalasea",
	milli: "checkMilli",
	gerami: "checkGerami",
});

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
		for (const source of USDT_SOURCE_PRIORITY) {
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

	async checkBitpin() {
		return this.#resilient("bitpin", () => this.#timed("bitpin", async () => {
			const url =
				this.config?.bitpinApiUrl ||
				this.env.BITPIN_API_URL ||
				"https://api.bitpin.ir/api/v1/mth/orderbook/USDT_IRT/";
			const response = await this.http.fetch(
				url,
				{ headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } },
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const price = nullableNumber(
				data?.asks?.[0]?.[0] ??
					data?.asks?.[0]?.price,
			);
			return price && price > 0
				? success(price, response.status)
				: failure("Invalid Bitpin response", response.status);
		}));
	}

	async checkNobitex() {
		return this.#resilient("nobitex", () => this.#timed("nobitex", async () => {
			const url =
				this.config?.nobitexApiUrl ||
				this.env.NOBITEX_API_URL ||
				"https://apiv2.nobitex.ir/v3/orderbook/USDTIRT";
			const response = await this.http.fetch(
				url,
				{ headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } },
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const price = nullableNumber(
				data?.asks?.[0]?.[0] ??
					data?.asks?.[0]?.price,
			);
			return price && price > 0
				? success(price, response.status)
				: failure("Invalid Nobitex response", response.status);
		}));
	}

	async resolveGold() {
		const results = {};
		await Promise.all(
			GOLD_SOURCE_NAMES.map(async (source) => {
				if (this.sourceSettings && !(await this.sourceSettings.isEnabled(source))) {
					results[source] = failure("Source disabled", null, 0);
					return;
				}
				results[source] = await this[GOLD_METHODS[source]]();
			}),
		);
		return resolveGoldConsensus(results);
	}

	async checkAllGold() {
		const results = {};
		await Promise.all(
			GOLD_SOURCE_NAMES.map(async (source) => {
				if (this.sourceSettings && !(await this.sourceSettings.isEnabled(source))) {
					results[source] = failure("Source disabled", null, 0);
					return;
				}
				results[source] = await this[GOLD_METHODS[source]]();
			}),
		);
		return results;
	}

	async checkWallGold() {
		return this.#gold("wallgold", async () => {
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
		});
	}

	async checkTechnoGold() {
		return this.#gold("technogold", async () => {
			const url =
				this.config?.technoGoldApiUrl ||
				this.env.TECHNOGOLD_API_URL ||
				"https://api2.technogold.gold/customer/tradeables/only-price/1";
			const response = await this.http.fetch(
				url,
				{
					headers: {
						Accept: "application/json",
						Origin: "https://technogold.gold",
						Referer: "https://technogold.gold/",
						"User-Agent": `DRD-Rate-Manager/${APP.version}`,
					},
				},
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const buy = nullableNumber(data?.results?.buy_price);
			const sell = nullableNumber(data?.results?.sell_price);
			const price = buy && sell ? (buy + sell) / 2 : buy || sell;
			return data?.succeed === true && price && price > 0
				? success(price, response.status)
				: failure("Invalid TechnoGold response", response.status);
		});
	}

	async checkMelliGold() {
		return this.#gold("melligold", async () => {
			const url =
				this.config?.melliGoldApiUrl ||
				this.env.MELLIGOLD_API_URL ||
				"https://melligold.com/api/v1/exchange/buy-sell-price/?symbol=XAU18&format=json";
			const response = await this.http.fetch(
				url,
				{
					headers: {
						Accept: "*/*",
						Referer: "https://melligold.com/",
						"User-Agent": `DRD-Rate-Manager/${APP.version}`,
					},
				},
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const buy = nullableNumber(data?.data?.price_buy);
			const sell = nullableNumber(data?.data?.price_sell);
			const price = buy && sell ? (buy + sell) / 2 : buy || sell;
			return data?.message === "Success" && price && price > 0
				? success(price, response.status)
				: failure("Invalid MelliGold response", response.status);
		});
	}

	async checkTalasea() {
		return this.#gold("talasea", async () => {
			const url =
				this.config?.talaseaApiUrl ||
				this.env.TALASEA_API_URL ||
				"https://api.talasea.ir/api/market/getGoldPrice";
			const response = await this.http.fetch(
				url,
				{
					headers: {
						Accept: "application/json",
						"Old-Auth": "false",
						Origin: "https://talasea.ir",
						Platform: "webClient",
						Referer: "https://talasea.ir/",
						"User-Agent": `DRD-Rate-Manager/${APP.version}`,
					},
				},
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const raw = nullableNumber(data?.price);
			const price = raw ? raw * 1000 : null;
			return price && price > 0
				? success(price, response.status)
				: failure("Invalid Talasea response", response.status);
		});
	}

	async checkMilli() {
		return this.#gold("milli", async () => {
			const url =
				this.config?.milliApiUrl ||
				this.env.MILLI_API_URL ||
				"https://milli.gold/api/v1/public/milli-price/detail";
			const response = await this.http.fetch(
				url,
				{
					headers: {
						Accept: "application/json",
						Referer: "https://milli.gold/app/home",
						"X-Channel": "MILLI",
						"X-Client-Version": "1.0.0",
						"X-Platform": "PWA",
						"User-Agent": `DRD-Rate-Manager/${APP.version}`,
					},
				},
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const raw = nullableNumber(data?.data?.price18);
			const price = raw ? raw * 100 : null;
			return Number(data?.code) === 0 && price && price > 0
				? success(price, response.status)
				: failure("Invalid Milli response", response.status);
		});
	}

	async checkGerami() {
		return this.#gold("gerami", async () => {
			const url =
				this.config?.geramiApiUrl ||
				this.env.GERAMI_API_URL ||
				"https://api.gerami.com/api/v1/pairs/XAU750g_IRT/chart?range=1%20MONTH";
			const response = await this.http.fetch(
				url,
				{
					headers: {
						Accept: "application/json",
						Origin: "https://gerami.com",
						Referer: "https://gerami.com/",
						"User-Agent": `DRD-Rate-Manager/${APP.version}`,
					},
				},
				7000,
			);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const pair = data?.data?.pair;
			const last = nullableNumber(pair?.price);
			const buy = nullableNumber(pair?.buy_price);
			const sell = nullableNumber(pair?.sell_price);
			const price = last || (buy && sell ? (buy + sell) / 2 : buy || sell);
			return price && price > 0
				? success(price, response.status)
				: failure("Invalid Gerami response", response.status);
		});
	}

	async #gold(source, operation) {
		const result = await this.#resilient(source, () => this.#timed(source, operation));
		if (!result.skipped) await this.statuses.save(source, result);
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
