import {
	APPLICATION_IDENTITY_ENV_KEYS,
	INFRASTRUCTURE_SECRET_ENV_KEYS,
	configurationOwnershipSnapshot,
} from "./config-ownership.js";
import { LEGACY_RUNTIME_ENV_KEYS } from "./runtime-settings.js";
import { LEGACY_SECURE_ENV_KEYS } from "./secure-settings.js";

function bool(value) {
	return value === true;
}

function stringArray(value) {
	return Array.isArray(value) ? value.map(String) : [];
}

function localVersions() {
	const ownership = configurationOwnershipSnapshot();
	return {
		ownership: ownership.version,
		runtime: ownership.runtimeSettingsVersion,
		secure: ownership.secureSettingsVersion,
	};
}

/**
 * Accepts either the Web Admin API envelope, its data payload, or the
 * configuration object itself.
 */
export function extractConfigurationProof(payload) {
	const candidate = payload?.data?.configuration ?? payload?.configuration ?? payload;
	const ownership = candidate?.ownership || {};
	const migration = candidate?.migration || {};
	const generatedAtRaw =
		payload?.data?.generated_at ??
		payload?.generated_at ??
		payload?.generatedAt ??
		null;
	const generatedAt = generatedAtRaw ? Date.parse(String(generatedAtRaw)) : Number.NaN;
	return {
		generatedAt,
		ownership: {
			version: Number(ownership.version),
			runtimeSettingsVersion: Number(
				ownership.runtime_settings_version ?? ownership.runtimeSettingsVersion,
			),
			secureSettingsVersion: Number(
				ownership.secure_settings_version ?? ownership.secureSettingsVersion,
			),
			valid: bool(ownership.valid),
		},
		migration: {
			runtimeReady: bool(migration.runtime_ready ?? migration.runtimeReady),
			secureReady: bool(migration.secure_ready ?? migration.secureReady),
			canRemoveLegacyRuntimeEnv: bool(
				migration.can_remove_legacy_runtime_env ??
					migration.canRemoveLegacyRuntimeEnv,
			),
			canRemoveLegacySecretEnv: bool(
				migration.can_remove_legacy_secret_env ??
					migration.canRemoveLegacySecretEnv,
			),
			canRemoveAllLegacyEnv: bool(
				migration.can_remove_all_legacy_env ??
					migration.canRemoveAllLegacyEnv,
			),
			blockers: Array.isArray(migration.blockers)
				? migration.blockers.map((item) => ({
					code: String(item?.code || "unknown"),
					keys: stringArray(item?.keys),
				}))
				: [],
		},
	};
}

export function validateConfigurationCleanupProof(
	payload,
	{
		now = Date.now(),
		maxAgeMs = 15 * 60 * 1000,
		maxFutureSkewMs = 2 * 60 * 1000,
	} = {},
) {
	const proof = extractConfigurationProof(payload);
	const expected = localVersions();
	const reasons = [];

	if (!Number.isFinite(proof.generatedAt)) reasons.push("snapshot_timestamp_missing");
	else {
		const age = now - proof.generatedAt;
		if (age > maxAgeMs) reasons.push("snapshot_stale");
		if (age < -maxFutureSkewMs) reasons.push("snapshot_from_future");
	}

	if (!proof.ownership.valid) reasons.push("ownership_invalid");
	if (proof.ownership.version !== expected.ownership) reasons.push("ownership_version_mismatch");
	if (proof.ownership.runtimeSettingsVersion !== expected.runtime) {
		reasons.push("runtime_settings_version_mismatch");
	}
	if (proof.ownership.secureSettingsVersion !== expected.secure) {
		reasons.push("secure_settings_version_mismatch");
	}
	if (!proof.migration.runtimeReady) reasons.push("runtime_not_ready");
	if (!proof.migration.secureReady) reasons.push("secure_not_ready");
	if (!proof.migration.canRemoveLegacyRuntimeEnv) reasons.push("runtime_env_cleanup_blocked");
	if (!proof.migration.canRemoveLegacySecretEnv) reasons.push("secret_env_cleanup_blocked");
	if (!proof.migration.canRemoveAllLegacyEnv) reasons.push("legacy_env_cleanup_blocked");
	if (proof.migration.blockers.length) reasons.push("migration_blockers_present");

	return {
		ok: reasons.length === 0,
		reasons,
		proof,
		expectedVersions: expected,
	};
}

/**
 * Returns a new wrangler object. It never mutates the supplied value.
 */
export function buildWranglerLegacyCleanup(wrangler, payload) {
	const validation = validateConfigurationCleanupProof(payload);
	if (!validation.ok) {
		const error = new Error(
			`Configuration cleanup proof rejected: ${validation.reasons.join(", ")}`,
		);
		error.code = "CONFIG_CLEANUP_NOT_READY";
		error.validation = validation;
		throw error;
	}

	const next = structuredClone(wrangler || {});
	const vars = { ...(next.vars || {}) };
	const removable = new Set([...LEGACY_RUNTIME_ENV_KEYS, ...LEGACY_SECURE_ENV_KEYS]);
	const removed = [];

	for (const key of removable) {
		if (Object.prototype.hasOwnProperty.call(vars, key)) {
			delete vars[key];
			removed.push(key);
		}
	}

	next.vars = vars;

	const preserved = [
		...APPLICATION_IDENTITY_ENV_KEYS.filter((key) =>
			Object.prototype.hasOwnProperty.call(vars, key),
		),
		...INFRASTRUCTURE_SECRET_ENV_KEYS.filter((key) =>
			Object.prototype.hasOwnProperty.call(vars, key),
		),
	];

	return {
		config: next,
		removedRuntimeVars: removed.filter((key) => LEGACY_RUNTIME_ENV_KEYS.includes(key)),
		removedSecureVars: removed.filter((key) => LEGACY_SECURE_ENV_KEYS.includes(key)),
		preservedDeploymentVars: preserved,
		manualLegacySecretCleanup: [...LEGACY_SECURE_ENV_KEYS],
		permanentInfrastructureSecrets: [...INFRASTRUCTURE_SECRET_ENV_KEYS],
	};
}
