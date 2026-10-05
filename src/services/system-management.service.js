import { APP } from "../config/app.js";
import {
	configurationMigrationReadiness,
	configurationOwnershipSnapshot,
} from "../config/config-ownership.js";
import { runtimeIntegrity } from "../app/runtime-integrity.js";
import { databaseStatus } from "../system/database-status.js";
import { parseBoolean } from "../utils/core.js";

function sourceHealth(snapshot = {}) {
	const items = Object.values(snapshot.sources || {});
	const enabled = items.filter((item) => item.enabled);
	const healthy = enabled.filter((item) => item.status?.success === true);
	const failed = enabled.filter((item) => item.status && item.status.success === false);
	const unchecked = enabled.filter((item) => !item.status);

	return {
		total: items.length,
		enabled: enabled.length,
		healthy: healthy.length,
		failed: failed.length,
		unchecked: unchecked.length,
		usdtPriority: snapshot.usdt_priority || [],
		items: items.map((item) => ({
			name: item.name,
			label: item.label,
			kind: item.kind,
			enabled: Boolean(item.enabled),
			healthy: item.status?.success === true,
			checked: Boolean(item.status),
			status: item.status?.status ?? null,
			latency: item.status?.latency ?? null,
			lastCheckedAt: Number(item.status?.lastCheckedAt || item.status?.last_checked_at || 0),
			message: item.status?.message || null,
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
	if (!cache.present) warnings.push("cache_empty");
	if (cache.expired) warnings.push("cache_expired");
	if (cache.lastError) warnings.push("cache_last_error");
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

	async snapshot(now = Date.now()) {
		const [
			database,
			sourceSnapshot,
			automationState,
			adminSnapshot,
			cacheRow,
			botEnabledRaw,
		] = await Promise.all([
			this.databaseStatusFn(this.s),
			this.s.sourceSettings.snapshot(),
			this.s.automationManagement.state(now, 5),
			this.s.adminManagement.snapshot({ type: "system", role: "owner", id: "system" }),
			this.s.cache.read(),
			this.s.settings.get("bot_enabled", "1"),
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
		"cache_empty",
		"cache_expired",
		"cache_last_error",
	]),
	notices: Object.freeze([
		"bot_disabled",
		"runtime_settings_legacy_fallback",
		"runtime_settings_default_fallback",
	]),
});
