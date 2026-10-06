import { APP } from "../config/app.js";
import { errorMessage, sleep } from "../utils/core.js";
import { calculateMazanehFromGram18 } from "../utils/formatters.js";
import { analyzeMarketSnapshot } from "./market-quality.js";
import { resolveUsdtChecks } from "./market-support.js";

const PARTIAL_CACHE_TTL_SECONDS = 60;

/** Central market cache/read-through service used by Bot, API and Cron. */
export class MarketService {
	constructor(env, config, settings, cache, locks, assets, statuses, sources, coinGecko, sourceSettings = null) {
		Object.assign(this, {
			env,
			config,
			settings,
			cache,
			locks,
			assets,
			statuses,
			sources,
			coinGecko,
			sourceSettings,
		});
	}

	async cacheTtlSeconds() {
		const raw = Number(
			await this.settings.get("market_cache_ttl_seconds", APP.defaultCacheTtlSeconds),
		);
		return Number.isFinite(raw)
			? Math.min(3600, Math.max(5, Math.round(raw)))
			: APP.defaultCacheTtlSeconds;
	}

	async getSnapshot({ forceRefresh = false, fullSourceCheck = false } = {}) {
		const ttlSeconds = await this.cacheTtlSeconds();
		const cached = await this.cache.read();
		const now = Date.now();
		if (!forceRefresh && cached && now < cached.expiresAt) {
			return this.#withCacheMeta(cached.payload, cached, ttlSeconds, true, false);
		}

		const token = await this.locks.acquire(APP.marketRefreshLockKey, APP.marketRefreshLockMs);
		if (!token) {
			if (cached) {
				return this.#withCacheMeta(
					cached.payload,
					cached,
					ttlSeconds,
					true,
					true,
					"refresh_in_progress",
				);
			}
			await sleep(150);
			const retry = await this.cache.read();
			if (retry) return this.#withCacheMeta(retry.payload, retry, ttlSeconds, true, false);
			throw new Error("Market refresh is already in progress");
		}

		try {
			const fresh = await this.#fetchLive(fullSourceCheck);
			const merged = this.#mergeStale(fresh, cached?.payload || null);
			const lastError = fresh.partial
				? fresh.errors.map((item) => `${item.source}: ${item.message}`).join(" | ").slice(0, 1000)
				: null;
			const writeTtlSeconds = fresh.partial
				? Math.min(ttlSeconds, PARTIAL_CACHE_TTL_SECONDS)
				: ttlSeconds;
			const meta = await this.cache.write(merged, writeTtlSeconds, lastError);
			return this.#withCacheMeta(
				merged,
				{ ...meta, lastError, configuredTtlSeconds: ttlSeconds },
				writeTtlSeconds,
				false,
				fresh.partial && Boolean(cached),
			);
		} catch (error) {
			if (cached) {
				return this.#withCacheMeta(
					cached.payload,
					cached,
					ttlSeconds,
					true,
					true,
					errorMessage(error),
				);
			}
			throw error;
		} finally {
			await this.locks.release(APP.marketRefreshLockKey, token);
		}
	}

	async forceRefreshSources() {
		await this.getSnapshot({ forceRefresh: true, fullSourceCheck: true });
		return this.statuses.all();
	}

	async #fetchLive(fullSourceCheck = false) {
		const enabledAssets = await this.assets.enabled();
		const [coinGeckoEnabled, wallGoldEnabled] = this.sourceSettings
			? await Promise.all([
				this.sourceSettings.isEnabled("coingecko"),
				this.sourceSettings.isEnabled("wallgold"),
			])
			: [true, true];
		const disabled = (source) => ({
			success: false,
			status: null,
			latency: 0,
			message: `${source} disabled`,
			price: null,
		});
		const [usdtResult, coinGecko, wallgold] = await Promise.all([
			fullSourceCheck ? this.sources.checkAllUsdt() : this.sources.resolveUsdt(),
			coinGeckoEnabled ? this.coinGecko.fetchMarketBundle(enabledAssets) : disabled("CoinGecko"),
			wallGoldEnabled ? this.sources.checkWallGold() : disabled("WallGold"),
		]);
		const usdt = fullSourceCheck ? resolveUsdtChecks(usdtResult) : usdtResult;
		if (coinGeckoEnabled && !coinGecko.skipped) {
			await this.statuses.save(
				"coingecko",
				coinGecko.success
					? {
						success: true,
						status: coinGecko.status,
						latency: coinGecko.latency,
						message: null,
						price: null,
					}
					: coinGecko,
			);
		}

		const errors = [];
		if (!usdt.success) errors.push({ source: "usdt", message: usdt.message || "USDT unavailable" });
		if (!coinGecko.success) {
			errors.push({ source: "coingecko", message: coinGecko.message || "CoinGecko unavailable" });
		}
		if (!wallgold.success) {
			errors.push({ source: "wallgold", message: wallgold.message || "WallGold unavailable" });
		}

		return {
			success: true,
			partial: errors.length > 0,
			errors,
			createdAt: Date.now(),
			usdt: {
				price: usdt.success ? usdt.price : null,
				source: usdt.success ? usdt.sourceLabel : null,
				fallbackLevel: usdt.success ? usdt.fallbackLevel : null,
			},
			crypto: coinGecko.success
				? coinGecko.crypto
				: enabledAssets.map((item) => ({
					id: item.coin_id,
					symbol: item.symbol,
					name: item.name,
					price: null,
					change24h: null,
					marketCapRank: item.market_cap_rank ?? null,
				})),
			metals: {
				gram18: wallgold.success ? wallgold.price : null,
				mazaneh: wallgold.success ? calculateMazanehFromGram18(wallgold.price) : null,
				gold: coinGecko.success ? coinGecko.gold : null,
				silver: coinGecko.success ? coinGecko.silver : null,
			},
		};
	}

	#mergeStale(fresh, stale) {
		if (!stale) return fresh;
		const staleCrypto = new Map((stale.crypto || []).map((coin) => [coin.id, coin]));
		return {
			...fresh,
			usdt: {
				...fresh.usdt,
				price: fresh.usdt.price ?? stale.usdt?.price ?? null,
				source: fresh.usdt.source ?? stale.usdt?.source ?? null,
				fallbackLevel: fresh.usdt.fallbackLevel ?? stale.usdt?.fallbackLevel ?? null,
			},
			crypto: (fresh.crypto || []).map((coin) => {
				const previous = staleCrypto.get(coin.id);
				return {
					...coin,
					price: coin.price ?? previous?.price ?? null,
					change24h: coin.change24h ?? previous?.change24h ?? null,
				};
			}),
			metals: {
				gram18: fresh.metals?.gram18 ?? stale.metals?.gram18 ?? null,
				mazaneh: fresh.metals?.mazaneh ?? stale.metals?.mazaneh ?? null,
				gold: fresh.metals?.gold ?? stale.metals?.gold ?? null,
				silver: fresh.metals?.silver ?? stale.metals?.silver ?? null,
			},
		};
	}

	#withCacheMeta(snapshot, cached, ttlSeconds, fromCache, staleFallback, overrideError = null) {
		const fetchedAt = Number(cached?.fetchedAt || Date.now());
		return {
			...snapshot,
			quality: analyzeMarketSnapshot(snapshot),
			cache: {
				fromCache,
				staleFallback,
				fetchedAt,
				expiresAt: Number(cached?.expiresAt || fetchedAt + ttlSeconds * 1000),
				ttlSeconds:
					cached?.fetchedAt && cached?.expiresAt
						? Math.max(
							1,
							Math.round((Number(cached.expiresAt) - Number(cached.fetchedAt)) / 1000),
						)
						: ttlSeconds,
				configuredTtlSeconds: cached?.configuredTtlSeconds ?? ttlSeconds,
				lastError: overrideError || cached?.lastError || null,
			},
		};
	}
}
