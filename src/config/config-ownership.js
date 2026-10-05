import {
	LEGACY_RUNTIME_ENV_KEYS,
	RUNTIME_SETTING_DEFINITIONS,
	RUNTIME_SETTINGS_VERSION,
} from "./runtime-settings.js";
import {
	LEGACY_SECURE_ENV_KEYS,
	SECURE_SETTING_DEFINITIONS,
	SECURE_SETTINGS_VERSION,
} from "./secure-settings.js";

export const CONFIG_OWNERSHIP_VERSION = 1;

export const INFRASTRUCTURE_BINDINGS = Object.freeze(["DB", "ASSETS"]);
export const INFRASTRUCTURE_SECRET_ENV_KEYS = Object.freeze(["APP_MASTER_KEY"]);
export const APPLICATION_IDENTITY_ENV_KEYS = Object.freeze(["APP_NAME", "APP_VERSION"]);

function unique(values) {
	return [...new Set(values)];
}

function intersection(left, right) {
	const rightSet = new Set(right);
	return left.filter((value) => rightSet.has(value));
}

/**
 * Returns configuration ownership metadata only. No live values or secret
 * material are included in this structure.
 */
export function configurationOwnershipSnapshot() {
	const runtimeKeys = RUNTIME_SETTING_DEFINITIONS.map((item) => item.key);
	const secureKeys = Object.keys(SECURE_SETTING_DEFINITIONS);
	const overlaps = {
		runtimeAndSecureKeys: intersection(runtimeKeys, secureKeys),
		runtimeAndSecureLegacyEnv: intersection(LEGACY_RUNTIME_ENV_KEYS, LEGACY_SECURE_ENV_KEYS),
		infraSecretAndLegacySecureEnv: intersection(INFRASTRUCTURE_SECRET_ENV_KEYS, LEGACY_SECURE_ENV_KEYS),
	};

	return {
		version: CONFIG_OWNERSHIP_VERSION,
		runtimeSettingsVersion: RUNTIME_SETTINGS_VERSION,
		secureSettingsVersion: SECURE_SETTINGS_VERSION,
		runtime: {
			owner: "d1_runtime_settings",
			keys: runtimeKeys,
			legacyEnvKeys: [...LEGACY_RUNTIME_ENV_KEYS],
		},
		secure: {
			owner: "encrypted_d1",
			keys: secureKeys,
			legacyEnvKeys: [...LEGACY_SECURE_ENV_KEYS],
		},
		infrastructure: {
			bindings: [...INFRASTRUCTURE_BINDINGS],
			secretEnvKeys: [...INFRASTRUCTURE_SECRET_ENV_KEYS],
		},
		identity: {
			owner: "deployment_identity",
			envKeys: [...APPLICATION_IDENTITY_ENV_KEYS],
		},
		overlaps,
		valid: Object.values(overlaps).every((items) => items.length === 0),
	};
}

/**
 * Determines whether legacy runtime/secret environment fallbacks can be
 * removed without changing the currently resolved configuration.
 */
export function configurationMigrationReadiness(runtimeStatus = {}, secureStatus = {}) {
	const invalidRuntimeKeys = unique(runtimeStatus.invalidD1Keys || []);
	const runtimeFallbackKeys = unique([
		...(runtimeStatus.legacyFallbackKeys || []),
		...(runtimeStatus.defaultFallbackKeys || []),
	]);
	const secureFallbackKeys = unique(secureStatus.legacyFallbackKeys || []);
	const secureSecrets = secureStatus.secrets || {};
	const missingSecureKeys = unique(
		Object.entries(secureSecrets)
			.filter(([, item]) => !item?.configured)
			.map(([key]) => key),
	);
	const managedCount = Number(secureStatus.managedCount);
	const encryptedCount = Number(secureStatus.encryptedCount);
	const hasSecureCoverage =
		Number.isFinite(managedCount) &&
		managedCount > 0 &&
		Number.isFinite(encryptedCount);
	const secureCoverageIncomplete =
		hasSecureCoverage &&
		encryptedCount < managedCount;

	const runtimeReady =
		Boolean(runtimeStatus.fullyMigrated) &&
		invalidRuntimeKeys.length === 0 &&
		runtimeFallbackKeys.length === 0;
	const secureReady =
		secureFallbackKeys.length === 0 &&
		missingSecureKeys.length === 0 &&
		!secureCoverageIncomplete;

	const blockers = [];
	if (invalidRuntimeKeys.length) {
		blockers.push({
			code: "runtime_settings_invalid",
			keys: invalidRuntimeKeys,
		});
	}
	if (!runtimeReady) {
		blockers.push({
			code: "runtime_settings_not_fully_d1",
			keys: runtimeFallbackKeys,
		});
	}
	if (secureFallbackKeys.length) {
		blockers.push({
			code: "secure_settings_legacy_fallback",
			keys: secureFallbackKeys,
		});
	}
	if (missingSecureKeys.length) {
		blockers.push({
			code: "secure_settings_missing",
			keys: missingSecureKeys,
		});
	}
	if (
		secureCoverageIncomplete &&
		secureFallbackKeys.length === 0 &&
		missingSecureKeys.length === 0
	) {
		blockers.push({
			code: "secure_settings_not_fully_encrypted",
			keys: [],
		});
	}

	return {
		runtimeReady,
		secureReady,
		canRemoveLegacyRuntimeEnv: runtimeReady,
		canRemoveLegacySecretEnv: secureReady,
		canRemoveAllLegacyEnv: runtimeReady && secureReady,
		blockers,
	};
}
