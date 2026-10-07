import {
	RUNTIME_SETTING_DEFINITIONS,
	RUNTIME_SETTING_MAP,
	RUNTIME_SETTINGS_VERSION,
	normalizeRuntimeSetting,
} from "../config/runtime-settings.js";
import {
	SECURE_SETTING_DEFINITIONS,
	SECURE_SETTING_KEYS,
	SECURE_SETTINGS_VERSION,
	isManagedSecureSetting,
} from "../config/secure-settings.js";

const MAX_RUNTIME_MUTATIONS = 64;
const MAX_SECRET_LENGTH = 4096;

function actorId(actor) {
	return String(actor?.id ?? "");
}

function publicRules(definition) {
	return {
		...(definition.options ? { options: [...definition.options] } : {}),
		...(definition.min != null ? { min: definition.min } : {}),
		...(definition.max != null ? { max: definition.max } : {}),
		...(definition.minLength != null ? { min_length: definition.minLength } : {}),
		...(definition.maxLength != null ? { max_length: definition.maxLength } : {}),
	};
}

function publicRuntimeEntry(settingsService, definition) {
	return {
		key: definition.key,
		category: definition.category,
		type: definition.type,
		value: settingsService.get(definition.key),
		source: settingsService.getSource(definition.key),
		default_value: normalizeRuntimeSetting(definition, definition.defaultValue),
		legacy_env_key: definition.legacyEnvKey || null,
		editable: true,
		rules: publicRules(definition),
	};
}

function secureCategory(key) {
	return String(key).split(".")[0] || "secure";
}

export class ConfigurationManagementService {
	constructor({
		settingsService,
		secureSettingsService,
		audit,
		webAuth,
		rawEnv,
	}) {
		this.settingsService = settingsService;
		this.secureSettingsService = secureSettingsService;
		this.audit = audit;
		this.webAuth = webAuth;
		this.rawEnv = rawEnv || {};
	}

	snapshot() {
		const secureStatus = this.secureSettingsService.status();
		return {
			runtime: {
				version: RUNTIME_SETTINGS_VERSION,
				entries: RUNTIME_SETTING_DEFINITIONS.map((definition) =>
					publicRuntimeEntry(this.settingsService, definition),
				),
			},
			secure: {
				version: SECURE_SETTINGS_VERSION,
				master_key_configured: Boolean(secureStatus.masterKeyConfigured),
				entries: SECURE_SETTING_KEYS.map((key) => {
					const definition = SECURE_SETTING_DEFINITIONS[key];
					const state = secureStatus.secrets?.[key] || {
						configured: false,
						source: "missing",
					};
					return {
						key,
						category: secureCategory(key),
						env_key: definition.envKey,
						configured: Boolean(state.configured),
						source: String(state.source || "missing"),
						editable: true,
						write_only: true,
					};
				}),
			},
			protected: {
				app_name: String(this.rawEnv.APP_NAME || "DRD RATE MANAGER"),
				app_version: String(this.rawEnv.APP_VERSION || ""),
				app_master_key_configured: Boolean(this.rawEnv.APP_MASTER_KEY),
				app_master_key_editable: false,
			},
		};
	}

	async updateRuntime(values, actor) {
		if (!values || typeof values !== "object" || Array.isArray(values)) {
			throw Object.assign(new Error("Runtime settings payload must be an object."), {
				statusCode: 400,
				code: "invalid_runtime_payload",
			});
		}
		const entries = Object.entries(values);
		if (!entries.length) {
			throw Object.assign(new Error("At least one runtime setting is required."), {
				statusCode: 400,
				code: "empty_runtime_payload",
			});
		}
		if (entries.length > MAX_RUNTIME_MUTATIONS) {
			throw Object.assign(new Error("Too many runtime settings in one request."), {
				statusCode: 413,
				code: "too_many_runtime_settings",
			});
		}

		for (const [key] of entries) {
			if (!RUNTIME_SETTING_MAP.has(key)) {
				throw Object.assign(new Error(`Unknown runtime setting: ${key}`), {
					statusCode: 400,
					code: "unknown_runtime_setting",
				});
			}
		}

		await this.settingsService.setMany(values);
		await this.audit.add(actorId(actor), "web.configuration.runtime_updated", {
			keys: entries.map(([key]) => key).sort(),
		});
		return this.snapshot();
	}

	async replaceSecret({ key, value, currentPassword, authenticated }, actor) {
		if (!isManagedSecureSetting(key)) {
			throw Object.assign(new Error(`Unknown secure setting: ${key}`), {
				statusCode: 404,
				code: "unknown_secure_setting",
			});
		}
		const normalized = String(value ?? "").trim();
		if (!normalized) {
			throw Object.assign(new Error("Secret value is required."), {
				statusCode: 400,
				code: "secret_required",
			});
		}
		if (normalized.length > MAX_SECRET_LENGTH) {
			throw Object.assign(new Error("Secret value is too long."), {
				statusCode: 413,
				code: "secret_too_long",
			});
		}

		await this.webAuth.confirmPassword(authenticated, currentPassword);
		await this.secureSettingsService.set(key, normalized);
		await this.audit.add(actorId(actor), "web.configuration.secret_replaced", {
			key,
		});

		const status = this.secureSettingsService.status();
		const state = status.secrets?.[key] || {};
		return {
			key,
			configured: Boolean(state.configured),
			source: String(state.source || "missing"),
			write_only: true,
		};
	}
}
