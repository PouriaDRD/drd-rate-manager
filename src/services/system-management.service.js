import { APP } from "../config/app.js";
import {
	configurationMigrationReadiness,
	configurationOwnershipSnapshot,
} from "../config/config-ownership.js";
import { runtimeIntegrity } from "../app/runtime-integrity.js";
import { databaseStatus } from "../system/database-status.js";
import { errorMessage, parseBoolean } from "../utils/core.js";
import {
	buildOperationalMetrics,
	OPERATIONAL_METRICS_WINDOW_MS,
} from "./operational-metrics.js";

function sourceHealth(snapshot = {}) {
	const items = Object.values(snapshot.sources || {});
	const enabled = items.filter((item) => item.enabled);
	const checkedAt = (item) =>
		Number(item.status?.lastCheckedAt || item.status?.last_checked_at || 0);
	const healthy = enabled.filter(
		(item) => checkedAt(item) > 0 && item.status?.success === true,
	);
	const failed = enabled.filter(
		(item) => checkedAt(item) > 0 && item.status?.success === false,
	);
	const unchecked = enabled.filter((item) => checkedAt(item) <= 0);

	return {
		total: items.length,
		enabled: enabled.length,
		healthy: healthy.length,
		failed: failed.length,
		unchecked: unchecked.length,
		usdtPriority: snapshot.usdt_priority || [],
		healthScore: snapshot.provider_health?.score ?? null,
		healthGrade: snapshot.provider_health?.grade || "unknown",
		openCircuits: Number(snapshot.provider_health?.openCircuits || 0),
		probes: Number(snapshot.provider_health?.probes || 0),
		unknownCircuits: Number(snapshot.provider_health?.unknownCircuits || 0),
		items: items.map((item) => ({
			name: item.name,
			label: item.label,
			kind: item.kind,
			enabled: Boolean(item.enabled),
			healthy: checkedAt(item) > 0 && item.status?.success === true,
			checked: checkedAt(item) > 0,
			status: item.status?.status ?? null,
			latency: item.status?.latency ?? null,
			lastCheckedAt: checkedAt(item),
			message: item.status?.message || null,
			healthScore: item.health?.score ?? null,
			healthGrade: item.health?.grade || (item.enabled ? "unknown" : "disabled"),
			circuitState: item.health?.circuit?.state || "unknown",
			circuitRetryAt: Number(item.health?.circuit?.retryAt || 0),
			circuitRemainingMs: Number(item.health?.circuit?.remainingMs || 0),
			circuitError: item.health?.circuit?.error || null,
		})),
	};
}

function cacheHealth(row, now) {
	if (!row) {
		return {
			present: false,
			fresh: false,
			expired: false,
			fetchedAt: 0,
			expiresAt: 0,
			ageSeconds: null,
			ttlRemainingSeconds: null,
			lastError: null,
		};
	}

	const fetchedAt = Number(row.fetchedAt || 0);
	const expiresAt = Number(row.expiresAt || 0);
	const expired = Boolean(expiresAt && expiresAt <= now);
	return {
		present: true,
		fresh: !expired,
		expired,
		fetchedAt,
		expiresAt,
		ageSeconds: fetchedAt ? Math.max(0, Math.floor((now - fetchedAt) / 1000)) : null,
		ttlRemainingSeconds: expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null,
		lastError: row.lastError || null,
	};
}

async function automationMetricStats(repository, now) {
	if (!repository?.stats) {
		return {
			supported: false,
			available: false,
			error: null,
		};
	}
	try {
		return {
			supported: true,
			available: true,
			...(await repository.stats(now - OPERATIONAL_METRICS_WINDOW_MS, now)),
			error: null,
		};
	} catch (error) {
		return {
			supported: true,
			available: false,
			error: errorMessage(error).slice(0, 500),
		};
	}
}

async function operationalAlertState(repository, configured) {
	if (!repository?.get) {
		return {
			configured,
			available: false,
			active: false,
			fingerprint: null,
			severity: null,
			reasons: [],
			firstSentAt: 0,
			lastSentAt: 0,
			recoveredAt: 0,
			error: null,
		};
	}
	try {
		const state = await repository.get();
		return {
			configured,
			available: true,
			active: Boolean(state.active),
			fingerprint: state.fingerprint || null,
			severity: state.severity || null,
			reasons: Array.isArray(state.reasons) ? state.reasons : [],
			firstSentAt: Number(state.firstSentAt || 0),
			lastSentAt: Number(state.lastSentAt || 0),
			recoveredAt: Number(state.recoveredAt || 0),
			error: null,
		};
	} catch (error) {
		return {
			configured,
			available: false,
			active: false,
			fingerprint: null,
			severity: null,
			reasons: [],
			firstSentAt: 0,
			lastSentAt: 0,
			recoveredAt: 0,
			error: errorMessage(error).slice(0, 500),
		};
	}
}

function secureStatus(status = {}) {
	return {
		version: status.version ?? null,
		initialized: Boolean(status.initialized),
		masterKeyConfigured: Boolean(status.masterKeyConfigured),
		encryptedCount: Number(status.encryptedCount || 0),
		managedCount: Number(status.managedCount || 0),
		fullyMigrated: Boolean(status.fullyMigrated),
		legacyFallbackCount: Array.isArray(status.legacyFallbackKeys)
			? status.legacyFallbackKeys.length
			: 0,
		missingCount: Object.values(status.secrets || {}).filter((item) => !item?.configured).length,
	};
}

function buildHealth({
	database,
	integrity,
	botEnabled,
	sources,
	cache,
	runtimeSettings,
	operationalMetrics,
}) {
	const critical = [];
	const warnings = [];
	const notices = [];

	if (!database.connected) critical.push("database_unavailable");
	if (!integrity) critical.push("runtime_integrity_failed");
	if (runtimeSettings.invalidD1Keys?.length) critical.push("runtime_settings_invalid");

	if (!botEnabled) notices.push("bot_disabled");
	if (!sources.enabled) warnings.push("no_sources_enabled");
	if (sources.failed) warnings.push("source_failures");
	if (sources.unchecked) warnings.push("sources_unverified");
	if (sources.openCircuits) warnings.push("provider_circuit_open");
	if (!cache.present) warnings.push("cache_empty");
	if (cache.expired) warnings.push("cache_expired");
	if (cache.lastError) warnings.push("cache_last_error");
	if (operationalMetrics?.supported && !operationalMetrics.available) {
		warnings.push("operational_metrics_unavailable");
	}
	if (runtimeSettings.legacyFallbackKeys?.length) notices.push("runtime_settings_legacy_fallback");
	if (runtimeSettings.defaultFallbackKeys?.length) notices.push("runtime_settings_default_fallback");

	let status = "healthy";
	if (critical.length) status = "critical";
	else if (!botEnabled) status = "disabled";
	else if (warnings.length) status = "degraded";

	return {
		status,
		reasonCodes: [...critical, ...warnings, ...notices],
		critical,
		warnings,
		notices,
	};
}

export class SystemManagementService {
	constructor(
		services,
		{
			databaseStatusFn = databaseStatus,
			runtimeIntegrityFn = runtimeIntegrity,
		} = {},
	) {
		this.s = services;
		this.databaseStatusFn = databaseStatusFn;
		this.runtimeIntegrityFn = runtimeIntegrityFn;
	}

	async healthSnapshot(now = Date.now()) {
		const [
			database,
			sourceSnapshot,
			cacheRow,
			botEnabledRaw,
			automationMetrics,
		] = await Promise.all([
			this.databaseStatusFn(this.s, { details: false }),
			this.s.providerHealth
				? this.s.providerHealth.snapshot(now)
				: this.s.sourceSettings.snapshot(),
			this.s.cache.read(),
			this.s.settings.get("bot_enabled", "1"),
			automationMetricStats(this.s.automationRuns, now),
		]);

		const integrity = Boolean(this.runtimeIntegrityFn());
		const botEnabled = parseBoolean(botEnabledRaw, true);
		const sources = sourceHealth(sourceSnapshot);
		const cache = cacheHealth(cacheRow, now);
		const runtimeSettings = this.s.settingsService.status();
		const health = buildHealth({
			database,
			integrity,
			botEnabled,
			sources,
			cache,
			runtimeSettings,
			operationalMetrics: automationMetrics,
		});
		const metrics = buildOperationalMetrics({
			now,
			automation: automationMetrics,
			database,
			cache,
			sources,
			health,
		});

		return {
			generatedAt: now,
			health,
			runtime: {
				version: this.s.config.version,
				schemaVersion: APP.schemaVersion,
				timezone: this.s.config.timezone,
				integrity,
				botEnabled,
			},
			database,
			cache,
			sources,
			metrics,
		};
	}

	async snapshot(now = Date.now()) {
		const [
			database,
			sourceSnapshot,
			automationState,
			adminSnapshot,
			cacheRow,
			botEnabledRaw,
			automationMetrics,
			alertState,
		] = await Promise.all([
			this.databaseStatusFn(this.s),
			this.s.providerHealth
				? this.s.providerHealth.snapshot(now)
				: this.s.sourceSettings.snapshot(),
			this.s.automationManagement.state(now, 5),
			this.s.adminManagement.snapshot({ type: "system", role: "owner", id: "system" }),
			this.s.cache.read(),
			this.s.settings.get("bot_enabled", "1"),
			automationMetricStats(this.s.automationRuns, now),
			operationalAlertState(
				this.s.operationalAlertRepository,
				Boolean(this.s.config.ownerId),
			),
		]);

		const integrity = Boolean(this.runtimeIntegrityFn());
		const botEnabled = parseBoolean(botEnabledRaw, true);
		const sources = sourceHealth(sourceSnapshot);
		const cache = cacheHealth(cacheRow, now);
		const runtimeSettings = this.s.settingsService.status();
		const rawSecureSettings = this.s.secureSettingsService.status();
		const secureSettings = secureStatus(rawSecureSettings);
		const configuration = {
			ownership: configurationOwnershipSnapshot(),
			migration: configurationMigrationReadiness(runtimeSettings, rawSecureSettings),
		};
		const health = buildHealth({
			database,
			integrity,
			botEnabled,
			sources,
			cache,
			runtimeSettings,
			operationalMetrics: automationMetrics,
		});
		const metrics = buildOperationalMetrics({
			now,
			automation: automationMetrics,
			database,
			cache,
			sources,
			health,
		});

		return {
			generatedAt: now,
			health,
			runtime: {
				version: this.s.config.version,
				schemaVersion: APP.schemaVersion,
				timezone: this.s.config.timezone,
				integrity,
				botEnabled,
			},
			database,
			cache,
			automation: {
				enabled: Boolean(automationState.settings.enabled),
				reason: automationState.diagnostics.reason,
				canPublishNow: Boolean(automationState.diagnostics.canPublishNow),
				nextPublishAt: Number(automationState.diagnostics.nextPublishAt || 0),
				lastSuccessAt: Number(automationState.settings.lastSuccessAt || 0),
				lastAttemptAt: Number(automationState.settings.lastAttemptAt || 0),
				lastErrorAt: Number(automationState.settings.lastErrorAt || 0),
				lastError: automationState.settings.lastError || null,
			},
			sources,
			admins: {
				total: adminSnapshot.stats.total,
				activeAdmins: adminSnapshot.stats.activeAdmins,
				inactiveAdmins: adminSnapshot.stats.inactiveAdmins,
				ownerConfigured: Boolean(adminSnapshot.stats.ownerConfigured),
			},
			settings: {
				runtime: runtimeSettings,
				secure: secureSettings,
			},
			metrics,
			alerts: alertState,
			configuration,
		};
	}
}

export const SYSTEM_HEALTH_REASONS = Object.freeze({
	critical: Object.freeze([
		"database_unavailable",
		"runtime_integrity_failed",
		"runtime_settings_invalid",
	]),
	warnings: Object.freeze([
		"no_sources_enabled",
		"source_failures",
		"sources_unverified",
		"provider_circuit_open",
		"cache_empty",
		"cache_expired",
		"cache_last_error",
		"operational_metrics_unavailable",
	]),
	notices: Object.freeze([
		"bot_disabled",
		"runtime_settings_legacy_fallback",
		"runtime_settings_default_fallback",
	]),
});
