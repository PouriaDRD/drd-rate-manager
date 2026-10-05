import { calculateNextPublishAt } from "../utils/automation.js";
import { coinNameFa } from "../utils/core.js";
import { formatIranDate, formatIranTime } from "../utils/datetime.js";

function isoOrNull(timestamp) {
	return timestamp ? new Date(timestamp).toISOString() : null;
}

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
	const nextPublishAt = calculateNextPublishAt({ ...automation, timezone: config.timezone });
	return {
		enabled: automation.enabled,
		interval_minutes: automation.intervalMinutes,
		quiet_hours: automation.quietHours,
		schedule_changed_at: isoOrNull(automation.scheduleChangedAt),
		next_publish_at: isoOrNull(nextPublishAt),
		last_run_at: isoOrNull(automation.lastRunAt),
		last_success_at: isoOrNull(automation.lastSuccessAt),
		last_success_slot_at: isoOrNull(automation.lastSuccessSlotAt),
		retry_slot_at: isoOrNull(automation.retrySlotAt),
		last_tick_at: isoOrNull(automation.lastTickAt),
		last_attempt_at: isoOrNull(automation.lastAttemptAt),
		last_error_at: isoOrNull(automation.lastErrorAt),
		last_skip_reason: automation.lastSkipReason || null,
		last_error: automation.lastError || null,
		timezone: config.timezone,
	};
}

export function serializeAutomationDiagnostics(config, diagnostics) {
	return {
		reason: diagnostics.reason,
		can_publish_now: Boolean(diagnostics.canPublishNow),
		inside_quiet_hours: Boolean(diagnostics.insideQuietHours),
		current_slot_at: isoOrNull(diagnostics.currentSlotAt),
		next_aligned_slot_at: isoOrNull(diagnostics.nextAlignedSlotAt),
		next_publish_at: isoOrNull(diagnostics.nextPublishAt),
		seconds_until_next: diagnostics.secondsUntilNext,
		retry_pending: Boolean(diagnostics.retryPending),
		last_error_pending: Boolean(diagnostics.lastErrorPending),
		timezone: config.timezone,
	};
}

export function serializeAutomationRun(run) {
	return {
		id: run.id ?? null,
		mode: run.mode,
		status: run.status,
		reason: run.reason || null,
		slot_at: isoOrNull(run.slotAt),
		started_at: isoOrNull(run.startedAt),
		finished_at: isoOrNull(run.finishedAt),
		actor_type: run.actorType || "system",
		actor_id: run.actorId ?? null,
		message_id: run.messageId ?? null,
		partial: Boolean(run.partial),
		error: run.error || null,
		details: run.details ?? null,
	};
}
