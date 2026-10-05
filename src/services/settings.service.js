import {
	RUNTIME_SETTING_DEFINITIONS,
	RUNTIME_SETTING_MAP,
	RUNTIME_SETTINGS_VERSION,
	normalizeRuntimeSetting,
	resolveRuntimeSettingFallback,
	serializeRuntimeSetting,
} from "../config/runtime-settings.js";

/**
 * Typed runtime settings facade.
 *
 * Resolution priority during the migration window:
 *   D1 setting -> legacy environment variable -> code default.
 *
 * Secret values are intentionally excluded until encrypted secret storage is
 * introduced in Phase 4.
 */
export class SettingsService {
	constructor(env, repository) {
		this.env = env;
		this.repository = repository;
		this.cache = new Map();
		this.loaded = false;
	}

	async refresh({ tolerateMissingTable = false } = {}) {
		try {
			const values = await this.repository.getMany(RUNTIME_SETTING_DEFINITIONS.map((item) => item.key));
			this.cache = new Map(Object.entries(values));
			this.loaded = true;
		} catch (error) {
			if (!tolerateMissingTable || !String(error?.message || error).toLowerCase().includes("no such table")) {
				throw error;
			}
			this.cache.clear();
			this.loaded = false;
		}
		return this.snapshot();
	}

	get(key) {
		const definition = this.#definition(key);
		if (this.cache.has(key)) {
			try {
				return normalizeRuntimeSetting(definition, this.cache.get(key));
			} catch {
				return resolveRuntimeSettingFallback(this.env, definition);
			}
		}
		return resolveRuntimeSettingFallback(this.env, definition);
	}

	getSource(key) {
		const definition = this.#definition(key);
		if (this.cache.has(key)) {
			try {
				normalizeRuntimeSetting(definition, this.cache.get(key));
				return "d1";
			} catch {
				return "d1_invalid";
			}
		}
		const legacy = definition.legacyEnvKey ? this.env?.[definition.legacyEnvKey] : undefined;
		return legacy !== undefined && legacy !== null && String(legacy).trim() !== "" ? "env" : "default";
	}

	async set(key, value) {
		const definition = this.#definition(key);
		const serialized = serializeRuntimeSetting(definition, value);
		await this.repository.set(key, serialized);
		this.cache.set(key, serialized);
		this.loaded = true;
		return this.get(key);
	}

	async setMany(values) {
		const serialized = {};
		for (const [key, value] of Object.entries(values)) {
			serialized[key] = serializeRuntimeSetting(this.#definition(key), value);
		}
		await this.repository.setMany(serialized);
		for (const [key, value] of Object.entries(serialized)) this.cache.set(key, value);
		this.loaded = true;
		return this.snapshot();
	}

	list() {
		return RUNTIME_SETTING_DEFINITIONS.map((definition) => ({
			key: definition.key,
			category: definition.category,
			type: definition.type,
			value: this.get(definition.key),
			source: this.getSource(definition.key),
			legacyEnvKey: definition.legacyEnvKey || null,
		}));
	}

	status() {
		const entries = this.list();
		const d1Count = entries.filter((item) => item.source === "d1").length;
		return {
			version: RUNTIME_SETTINGS_VERSION,
			loaded: this.loaded,
			total: entries.length,
			d1Count,
			invalidD1Keys: entries.filter((item) => item.source === "d1_invalid").map((item) => item.key),
			legacyFallbackKeys: entries.filter((item) => item.source === "env").map((item) => item.key),
			defaultFallbackKeys: entries.filter((item) => item.source === "default").map((item) => item.key),
			fullyMigrated: d1Count === entries.length,
		};
	}

	snapshot() {
		return Object.fromEntries(RUNTIME_SETTING_DEFINITIONS.map((definition) => [definition.key, this.get(definition.key)]));
	}

	#definition(key) {
		const definition = RUNTIME_SETTING_MAP.get(key);
		if (!definition) throw new Error(`Unknown runtime setting: ${key}`);
		return definition;
	}
}
