import {
	SECURE_SETTING_KEYS,
	SECURE_SETTINGS_VERSION,
	isManagedSecureSetting,
	legacySecureSettingValue,
} from "../config/secure-settings.js";

function isMissingTableError(error) {
	return String(error?.message || error || "").toLowerCase().includes("no such table");
}

export class SecureSettingsService {
	constructor(env, repository, secretCrypto) {
		this.env = env;
		this.repository = repository;
		this.secretCrypto = secretCrypto;
		this.cache = new Map();
		this.sources = new Map();
		this.initialized = false;
	}

	async refresh({ tolerateMissingTable = false } = {}) {
		let rows;
		try {
			rows = await this.repository.all();
		} catch (error) {
			if (!tolerateMissingTable || !isMissingTableError(error)) throw error;
			this.#loadLegacyOnly();
			return this.status();
		}

		const rowMap = new Map(rows.map((row) => [row.key, row]));
		const hasEncryptedRows = rows.length > 0;
		if (hasEncryptedRows && !this.secretCrypto.configured) {
			throw new Error("APP_MASTER_KEY is required because encrypted secure settings already exist in D1.");
		}
		if (this.secretCrypto.configured) this.secretCrypto.validateMasterKey();

		this.cache.clear();
		this.sources.clear();

		for (const key of SECURE_SETTING_KEYS) {
			const row = rowMap.get(key);
			if (row) {
				const value = await this.secretCrypto.decrypt(key, row);
				this.cache.set(key, value);
				this.sources.set(key, "encrypted_d1");
				continue;
			}

			const legacyValue = legacySecureSettingValue(this.env, key);
			if (legacyValue && this.secretCrypto.configured) {
				const encrypted = await this.secretCrypto.encrypt(key, legacyValue);
				await this.repository.upsert(key, encrypted);
				this.cache.set(key, legacyValue);
				this.sources.set(key, "encrypted_d1");
				continue;
			}

			this.cache.set(key, legacyValue);
			this.sources.set(key, legacyValue ? "legacy_env" : "missing");
		}

		this.initialized = true;
		return this.status();
	}

	get(key) {
		if (!isManagedSecureSetting(key)) throw new Error(`Unknown secure setting: ${key}`);
		if (this.cache.has(key)) return this.cache.get(key);
		return legacySecureSettingValue(this.env, key);
	}

	async set(key, value) {
		if (!isManagedSecureSetting(key)) throw new Error(`Unknown secure setting: ${key}`);
		if (!this.secretCrypto.configured) {
			throw new Error("APP_MASTER_KEY is required before secure settings can be changed.");
		}
		const normalized = String(value ?? "");
		const encrypted = await this.secretCrypto.encrypt(key, normalized);
		await this.repository.upsert(key, encrypted);
		this.cache.set(key, normalized);
		this.sources.set(key, "encrypted_d1");
		this.initialized = true;
	}

	status() {
		const secrets = {};
		const encryptedKeys = [];
		const legacyFallbackKeys = [];
		for (const key of SECURE_SETTING_KEYS) {
			const value = this.cache.has(key) ? this.cache.get(key) : legacySecureSettingValue(this.env, key);
			const source = this.sources.get(key) || (value ? "legacy_env" : "missing");
			if (source === "encrypted_d1") encryptedKeys.push(key);
			if (source === "legacy_env") legacyFallbackKeys.push(key);
			secrets[key] = { configured: Boolean(value), source };
		}
		return {
			version: SECURE_SETTINGS_VERSION,
			initialized: this.initialized,
			masterKeyConfigured: this.secretCrypto.configured,
			encryptedCount: encryptedKeys.length,
			managedCount: SECURE_SETTING_KEYS.length,
			fullyMigrated: legacyFallbackKeys.length === 0,
			encryptedKeys,
			legacyFallbackKeys,
			secrets,
		};
	}

	#loadLegacyOnly() {
		this.cache.clear();
		this.sources.clear();
		for (const key of SECURE_SETTING_KEYS) {
			const value = legacySecureSettingValue(this.env, key);
			this.cache.set(key, value);
			this.sources.set(key, value ? "legacy_env" : "missing");
		}
		this.initialized = true;
	}
}
