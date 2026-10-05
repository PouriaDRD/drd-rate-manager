export class SettingsRepository {
	constructor(env) {
		this.env = env;
	}

	async get(key, fallback = null) {
		const row = await this.env.DB.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1")
			.bind(key)
			.first();
		return row?.value ?? fallback;
	}

	async getMany(keys) {
		if (!keys.length) return {};
		const placeholders = keys.map(() => "?").join(",");
		const result = await this.env.DB.prepare(
			`SELECT key, value FROM settings WHERE key IN (${placeholders})`,
		)
			.bind(...keys)
			.all();
		return Object.fromEntries((result.results || []).map((row) => [row.key, row.value]));
	}

	async getManyWithMeta(keys) {
		if (!keys.length) return {};
		const placeholders = keys.map(() => "?").join(",");
		const result = await this.env.DB.prepare(
			`SELECT key, value, updated_at FROM settings WHERE key IN (${placeholders})`,
		)
			.bind(...keys)
			.all();
		return Object.fromEntries((result.results || []).map((row) => [
			row.key,
			{ value: row.value, updatedAt: Number(row.updated_at || 0) },
		]));
	}

	async set(key, value) {
		const now = Date.now();
		await this.env.DB.prepare(`INSERT INTO settings (key, value, created_at, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
			.bind(key, String(value), now, now)
			.run();
	}

	async setMany(values) {
		const now = Date.now();
		const statements = Object.entries(values).map(([key, value]) =>
			this.env.DB.prepare(`INSERT INTO settings (key, value, created_at, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
				.bind(key, String(value ?? ""), now, now),
		);
		if (statements.length) await this.env.DB.batch(statements);
	}
}
