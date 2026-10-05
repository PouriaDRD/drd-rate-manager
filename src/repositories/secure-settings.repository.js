export class SecureSettingsRepository {
	constructor(env) {
		this.env = env;
	}

	async all() {
		const result = await this.env.DB.prepare(
			`SELECT key, ciphertext, iv, algorithm, key_version, created_at, updated_at
			 FROM secure_settings ORDER BY key ASC`,
		).all();
		return (result.results || []).map((row) => ({
			key: String(row.key),
			ciphertext: String(row.ciphertext),
			iv: String(row.iv),
			algorithm: String(row.algorithm),
			keyVersion: Number(row.key_version),
			createdAt: Number(row.created_at || 0),
			updatedAt: Number(row.updated_at || 0),
		}));
	}

	async upsert(key, encrypted) {
		const now = Date.now();
		await this.env.DB.prepare(`INSERT INTO secure_settings
			(key, ciphertext, iv, algorithm, key_version, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET
				ciphertext = excluded.ciphertext,
				iv = excluded.iv,
				algorithm = excluded.algorithm,
				key_version = excluded.key_version,
				updated_at = excluded.updated_at`)
			.bind(key, encrypted.ciphertext, encrypted.iv, encrypted.algorithm, encrypted.keyVersion, now, now)
			.run();
	}
}
