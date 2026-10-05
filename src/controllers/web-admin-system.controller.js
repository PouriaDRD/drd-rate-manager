import { adminEmptyResponse, adminJsonResponse } from "../http/admin-responses.js";

function isoOrNull(timestamp) {
	return timestamp ? new Date(timestamp).toISOString() : null;
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
