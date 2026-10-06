import { adminEmptyResponse, adminJsonResponse } from "../http/admin-responses.js";

function isoOrNull(timestamp) {
	return timestamp ? new Date(timestamp).toISOString() : null;
}

function serializeConfiguration(configuration = {}) {
	const ownership = configuration.ownership || {};
	const migration = configuration.migration || {};
	return {
		ownership: {
			version: ownership.version ?? null,
			runtime_settings_version: ownership.runtimeSettingsVersion ?? null,
			secure_settings_version: ownership.secureSettingsVersion ?? null,
			valid: Boolean(ownership.valid),
			runtime_owner: ownership.runtime?.owner || null,
			secure_owner: ownership.secure?.owner || null,
			legacy_runtime_env_count: ownership.runtime?.legacyEnvKeys?.length || 0,
			legacy_secure_env_count: ownership.secure?.legacyEnvKeys?.length || 0,
			infrastructure_bindings: ownership.infrastructure?.bindings || [],
			infrastructure_secret_env_keys: ownership.infrastructure?.secretEnvKeys || [],
			deployment_identity_env_keys: ownership.identity?.envKeys || [],
		},
		migration: {
			runtime_ready: Boolean(migration.runtimeReady),
			secure_ready: Boolean(migration.secureReady),
			can_remove_legacy_runtime_env: Boolean(migration.canRemoveLegacyRuntimeEnv),
			can_remove_legacy_secret_env: Boolean(migration.canRemoveLegacySecretEnv),
			can_remove_all_legacy_env: Boolean(migration.canRemoveAllLegacyEnv),
			blockers: (migration.blockers || []).map((item) => ({
				code: String(item.code || ""),
				keys: Array.isArray(item.keys) ? item.keys.map(String) : [],
			})),
		},
	};
}

function serializeSystem(snapshot) {
	return {
		generated_at: new Date(snapshot.generatedAt).toISOString(),
		health: {
			status: snapshot.health.status,
			reason_codes: snapshot.health.reasonCodes,
			critical: snapshot.health.critical,
			warnings: snapshot.health.warnings,
			notices: snapshot.health.notices,
		},
		runtime: {
			version: snapshot.runtime.version,
			schema_version: snapshot.runtime.schemaVersion,
			timezone: snapshot.runtime.timezone,
			integrity: snapshot.runtime.integrity,
			bot_enabled: snapshot.runtime.botEnabled,
		},
		database: snapshot.database,
		cache: {
			present: snapshot.cache.present,
			fresh: snapshot.cache.fresh,
			expired: snapshot.cache.expired,
			fetched_at: isoOrNull(snapshot.cache.fetchedAt),
			expires_at: isoOrNull(snapshot.cache.expiresAt),
			age_seconds: snapshot.cache.ageSeconds,
			ttl_remaining_seconds: snapshot.cache.ttlRemainingSeconds,
			last_error: snapshot.cache.lastError,
		},
		automation: {
			enabled: snapshot.automation.enabled,
			reason: snapshot.automation.reason,
			can_publish_now: snapshot.automation.canPublishNow,
			next_publish_at: isoOrNull(snapshot.automation.nextPublishAt),
			last_success_at: isoOrNull(snapshot.automation.lastSuccessAt),
			last_attempt_at: isoOrNull(snapshot.automation.lastAttemptAt),
			last_error_at: isoOrNull(snapshot.automation.lastErrorAt),
			last_error: snapshot.automation.lastError,
		},
		sources: {
			total: snapshot.sources.total,
			enabled: snapshot.sources.enabled,
			healthy: snapshot.sources.healthy,
			failed: snapshot.sources.failed,
			unchecked: snapshot.sources.unchecked,
			health_score: snapshot.sources.healthScore,
			health_grade: snapshot.sources.healthGrade,
			open_circuits: snapshot.sources.openCircuits,
			probes: snapshot.sources.probes,
			unknown_circuits: snapshot.sources.unknownCircuits,
			usdt_priority: snapshot.sources.usdtPriority,
			items: snapshot.sources.items.map((item) => ({
				name: item.name,
				label: item.label,
				kind: item.kind,
				enabled: item.enabled,
				healthy: item.healthy,
				checked: item.checked,
				http_status: item.status,
				latency_ms: item.latency,
				last_checked_at: isoOrNull(item.lastCheckedAt),
				message: item.message,
				health_score: item.healthScore,
				health_grade: item.healthGrade,
				circuit_state: item.circuitState,
				circuit_retry_at: isoOrNull(item.circuitRetryAt),
				circuit_remaining_ms: item.circuitRemainingMs,
				circuit_error: item.circuitError,
			})),
		},
		admins: {
			total: snapshot.admins.total,
			active_admins: snapshot.admins.activeAdmins,
			inactive_admins: snapshot.admins.inactiveAdmins,
			owner_configured: snapshot.admins.ownerConfigured,
		},
		settings: {
			runtime: {
				version: snapshot.settings.runtime.version,
				loaded: snapshot.settings.runtime.loaded,
				total: snapshot.settings.runtime.total,
				d1_count: snapshot.settings.runtime.d1Count,
				invalid_d1_keys: snapshot.settings.runtime.invalidD1Keys,
				legacy_fallback_keys: snapshot.settings.runtime.legacyFallbackKeys,
				default_fallback_keys: snapshot.settings.runtime.defaultFallbackKeys,
				fully_migrated: snapshot.settings.runtime.fullyMigrated,
			},
			secure: {
				version: snapshot.settings.secure.version,
				initialized: snapshot.settings.secure.initialized,
				master_key_configured: snapshot.settings.secure.masterKeyConfigured,
				encrypted_count: snapshot.settings.secure.encryptedCount,
				managed_count: snapshot.settings.secure.managedCount,
				fully_migrated: snapshot.settings.secure.fullyMigrated,
				legacy_fallback_count: snapshot.settings.secure.legacyFallbackCount,
				missing_count: snapshot.settings.secure.missingCount,
			},
		},
		metrics: {
			window_hours: snapshot.metrics?.windowHours ?? 24,
			window_start_at: isoOrNull(snapshot.metrics?.windowStartAt),
			window_end_at: isoOrNull(snapshot.metrics?.windowEndAt),
			system: {
				status: snapshot.metrics?.system?.status || "unknown",
				reason_count: Number(snapshot.metrics?.system?.reasonCount || 0),
			},
			automation: {
				supported: snapshot.metrics?.automation?.supported !== false,
				available: Boolean(snapshot.metrics?.automation?.available),
				total_runs: Number(snapshot.metrics?.automation?.totalRuns || 0),
				success_count: Number(snapshot.metrics?.automation?.successCount || 0),
				error_count: Number(snapshot.metrics?.automation?.errorCount || 0),
				partial_count: Number(snapshot.metrics?.automation?.partialCount || 0),
				success_rate: snapshot.metrics?.automation?.successRate ?? null,
				error_rate: snapshot.metrics?.automation?.errorRate ?? null,
				partial_rate: snapshot.metrics?.automation?.partialRate ?? null,
				average_duration_ms: snapshot.metrics?.automation?.averageDurationMs ?? null,
				last_success_at: isoOrNull(snapshot.metrics?.automation?.lastSuccessAt),
				last_error_at: isoOrNull(snapshot.metrics?.automation?.lastErrorAt),
				error: snapshot.metrics?.automation?.error || null,
			},
			database: {
				connected: Boolean(snapshot.metrics?.database?.connected),
				latency_ms: snapshot.metrics?.database?.latencyMs ?? null,
			},
			cache: {
				present: Boolean(snapshot.metrics?.cache?.present),
				fresh: Boolean(snapshot.metrics?.cache?.fresh),
				age_seconds: snapshot.metrics?.cache?.ageSeconds ?? null,
				has_last_error: Boolean(snapshot.metrics?.cache?.hasLastError),
			},
			providers: {
				enabled: Number(snapshot.metrics?.providers?.enabled || 0),
				healthy: Number(snapshot.metrics?.providers?.healthy || 0),
				failed: Number(snapshot.metrics?.providers?.failed || 0),
				unchecked: Number(snapshot.metrics?.providers?.unchecked || 0),
				health_score: snapshot.metrics?.providers?.healthScore ?? null,
				health_grade: snapshot.metrics?.providers?.healthGrade || "unknown",
				open_circuits: Number(snapshot.metrics?.providers?.openCircuits || 0),
			},
		},
		alerts: {
			configured: Boolean(snapshot.alerts?.configured),
			available: Boolean(snapshot.alerts?.available),
			active: Boolean(snapshot.alerts?.active),
			fingerprint: snapshot.alerts?.fingerprint || null,
			severity: snapshot.alerts?.severity || null,
			reasons: snapshot.alerts?.reasons || [],
			first_sent_at: isoOrNull(snapshot.alerts?.firstSentAt),
			last_sent_at: isoOrNull(snapshot.alerts?.lastSentAt),
			recovered_at: isoOrNull(snapshot.alerts?.recoveredAt),
			error: snapshot.alerts?.error || null,
		},
		configuration: serializeConfiguration(snapshot.configuration),
	};
}

export class WebAdminSystemController {
	constructor(services) {
		this.s = services;
	}

	async route(request, url) {
		const state = await this.s.webAuth.routingState();
		const path = `/${state.adminPath}/api/v1/system`;
		if (url.pathname !== path) return null;
		if (request.method === "OPTIONS") return adminEmptyResponse(204);
		if (request.method !== "GET") {
			return adminJsonResponse({ success: false, message: "Method not allowed" }, 405);
		}

		const auth = await this.s.webAuth.authenticate(request, { requireCsrf: false });
		if (!auth) return adminJsonResponse({ success: false, message: "Unauthorized" }, 401);
		if (Number(auth.user.must_complete_bootstrap)) {
			return adminJsonResponse({ success: false, message: "Complete bootstrap first." }, 403);
		}

		try {
			const snapshot = await this.s.systemManagement.snapshot();
			return adminJsonResponse({ success: true, data: serializeSystem(snapshot) });
		} catch (error) {
			return adminJsonResponse(
				{ success: false, message: String(error?.message || error) },
				500,
			);
		}
	}
}

export { serializeSystem };
