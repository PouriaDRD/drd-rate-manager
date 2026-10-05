import { SECURE_SETTING_ENV_MAP } from "./secure-settings.js";

/**
 * Provides backward-compatible env access while sourcing managed secrets from
 * encrypted D1 after SecureSettingsService initialization.
 *
 * The environment-to-secret mapping is derived from secure-settings.js so a
 * new managed secret cannot silently drift between the two catalogs.
 */
export function createRuntimeEnv(env, secureSettingsService) {
	return new Proxy(env, {
		get(target, property) {
			const secureKey = typeof property === "string"
				? SECURE_SETTING_ENV_MAP[property]
				: null;
			if (secureKey) return secureSettingsService.get(secureKey);
			return target[property];
		},
	});
}
