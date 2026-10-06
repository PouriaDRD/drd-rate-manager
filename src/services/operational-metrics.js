export const OPERATIONAL_METRICS_WINDOW_HOURS = 24;
export const OPERATIONAL_METRICS_WINDOW_MS =
	OPERATIONAL_METRICS_WINDOW_HOURS * 60 * 60 * 1000;

function percent(part, total) {
	const denominator = Number(total || 0);
	if (denominator <= 0) return null;
	return Math.round((Number(part || 0) / denominator) * 1000) / 10;
}

export function buildOperationalMetrics({
	now = Date.now(),
	automation = {},
	database = {},
	cache = {},
	sources = {},
	health = {},
} = {}) {
	const totalRuns = Number(automation.total || 0);
	const successCount = Number(automation.successCount || 0);
	const errorCount = Number(automation.errorCount || 0);
	const partialCount = Number(automation.partialCount || 0);

	return {
		windowHours: OPERATIONAL_METRICS_WINDOW_HOURS,
		windowStartAt: now - OPERATIONAL_METRICS_WINDOW_MS,
		windowEndAt: now,
		system: {
			status: health.status || "unknown",
			reasonCount: Array.isArray(health.reasonCodes) ? health.reasonCodes.length : 0,
		},
		automation: {
			supported: automation.supported !== false,
			available: Boolean(automation.available),
			totalRuns,
			successCount,
			errorCount,
			partialCount,
			successRate: percent(successCount, totalRuns),
			errorRate: percent(errorCount, totalRuns),
			partialRate: percent(partialCount, totalRuns),
			averageDurationMs:
				automation.averageDurationMs == null
					? null
					: Math.max(0, Math.round(Number(automation.averageDurationMs) || 0)),
			lastSuccessAt: Number(automation.lastSuccessAt || 0),
			lastErrorAt: Number(automation.lastErrorAt || 0),
			error: automation.error || null,
		},
		database: {
			connected: Boolean(database.connected),
			latencyMs:
				database.latency_ms == null ? null : Math.max(0, Number(database.latency_ms) || 0),
		},
		cache: {
			present: Boolean(cache.present),
			fresh: Boolean(cache.fresh),
			ageSeconds: cache.ageSeconds == null ? null : Math.max(0, Number(cache.ageSeconds) || 0),
			hasLastError: Boolean(cache.lastError),
		},
		providers: {
			enabled: Number(sources.enabled || 0),
			healthy: Number(sources.healthy || 0),
			failed: Number(sources.failed || 0),
			unchecked: Number(sources.unchecked || 0),
			healthScore: sources.healthScore == null ? null : Number(sources.healthScore),
			healthGrade: sources.healthGrade || "unknown",
			openCircuits: Number(sources.openCircuits || 0),
		},
	};
}
