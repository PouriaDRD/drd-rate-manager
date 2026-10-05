import { coinNameFa } from "../utils/core.js";
import { formatIranDate, formatIranTime } from "../utils/datetime.js";

export function serializeMarketSnapshot(config, snapshot) {
	return {
		generated_at: new Date(snapshot.createdAt).toISOString(),
		timezone: config.timezone,
		date: formatIranDate(config, snapshot.createdAt),
		time: formatIranTime(config, snapshot.createdAt),
		partial: Boolean(snapshot.partial),
		cache: snapshot.cache ? {
			from_cache: Boolean(snapshot.cache.fromCache),
			stale_fallback: Boolean(snapshot.cache.staleFallback),
			fetched_at: new Date(snapshot.cache.fetchedAt).toISOString(),
			expires_at: new Date(snapshot.cache.expiresAt).toISOString(),
			ttl_seconds: snapshot.cache.ttlSeconds,
			last_error: snapshot.cache.lastError || null,
		} : null,
		errors: snapshot.errors || [],
		usdt: {
			available: snapshot.usdt?.price != null,
			price_toman: snapshot.usdt?.price ?? null,
			source: snapshot.usdt?.source ?? null,
			fallback_level: snapshot.usdt?.fallbackLevel ?? null,
		},
		crypto: (snapshot.crypto || []).map((item) => ({
			id: item.id,
			name: item.name,
			name_fa: coinNameFa(item.id, item.name),
			symbol: item.symbol,
			available: item.price != null,
			price_usd: item.price ?? null,
			change_24h_percent: item.change24h ?? null,
			market_cap_rank: item.marketCapRank ?? null,
		})),
		metals: {
			gram_18_toman: snapshot.metals?.gram18 ?? null,
			mazaneh_toman: snapshot.metals?.mazaneh ?? null,
			gold_usd: snapshot.metals?.gold ?? null,
			silver_usd: snapshot.metals?.silver ?? null,
		},
	};
}

export function serializeAutomation(config, automation) {
	return {
		enabled: automation.enabled,
		interval_minutes: automation.intervalMinutes,
		quiet_hours: automation.quietHours,
		last_run_at: automation.lastRunAt ? new Date(automation.lastRunAt).toISOString() : null,
		last_success_at: automation.lastSuccessAt ? new Date(automation.lastSuccessAt).toISOString() : null,
		last_tick_at: automation.lastTickAt ? new Date(automation.lastTickAt).toISOString() : null,
		last_attempt_at: automation.lastAttemptAt ? new Date(automation.lastAttemptAt).toISOString() : null,
		last_error_at: automation.lastErrorAt ? new Date(automation.lastErrorAt).toISOString() : null,
		last_skip_reason: automation.lastSkipReason || null,
		last_error: automation.lastError || null,
		timezone: config.timezone,
	};
}
