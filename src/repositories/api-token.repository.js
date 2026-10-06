const TOKEN_COLUMNS = `id, name, token_type, token_prefix, is_enabled, expires_at,
	last_used_at, usage_count, revoked_at, created_by_type, created_by_id, created_at, updated_at`;

function rowToMetadata(row) {
	if (!row) return null;
	return {
		id: Number(row.id),
		name: String(row.name || ""),
		type: String(row.token_type || ""),
		prefix: String(row.token_prefix || ""),
		enabled: Number(row.is_enabled) === 1,
		expiresAt: Number(row.expires_at || 0),
		lastUsedAt: Number(row.last_used_at || 0),
		usageCount: Number(row.usage_count || 0),
		revokedAt: Number(row.revoked_at || 0),
		createdByType: String(row.created_by_type || "system"),
		createdById: row.created_by_id == null ? null : String(row.created_by_id),
		createdAt: Number(row.created_at || 0),
		updatedAt: Number(row.updated_at || 0),
	};
}

export class ApiTokenRepository {
	constructor(env) {
		this.env = env;
	}

	async create(record) {
		const result = await this.env.DB.prepare(`INSERT INTO api_tokens (
			name, token_type, token_prefix, token_hash, is_enabled, expires_at,
			last_used_at, usage_count, revoked_at, created_by_type, created_by_id,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, 1, ?, 0, 0, 0, ?, ?, ?, ?)`)
			.bind(
				record.name,
				record.type,
				record.prefix,
				record.tokenHash,
				Number(record.expiresAt || 0),
				record.createdByType || "system",
				record.createdById == null ? null : String(record.createdById),
				record.createdAt,
				record.createdAt,
			)
			.run();
		return this.getById(Number(result?.meta?.last_row_id || 0));
	}

	async getById(id) {
		const row = await this.env.DB.prepare(
			`SELECT ${TOKEN_COLUMNS} FROM api_tokens WHERE id = ? LIMIT 1`,
		)
			.bind(Number(id))
			.first();
		return rowToMetadata(row);
	}

	async findByHash(tokenHash) {
		const row = await this.env.DB.prepare(`SELECT
			${TOKEN_COLUMNS}, token_hash
			FROM api_tokens WHERE token_hash = ? LIMIT 1`)
			.bind(String(tokenHash))
			.first();
		if (!row) return null;
		return {
			...rowToMetadata(row),
			tokenHash: String(row.token_hash || ""),
		};
	}

	async list(type = null) {
		const result = type
			? await this.env.DB.prepare(
					`SELECT ${TOKEN_COLUMNS} FROM api_tokens
					 WHERE token_type = ? ORDER BY id DESC`,
				)
					.bind(String(type))
					.all()
			: await this.env.DB.prepare(
					`SELECT ${TOKEN_COLUMNS} FROM api_tokens ORDER BY id DESC`,
				).all();
		return (result.results || []).map(rowToMetadata);
	}

	async setEnabled(id, enabled, now = Date.now()) {
		await this.env.DB.prepare(
			"UPDATE api_tokens SET is_enabled = ?, updated_at = ? WHERE id = ? AND revoked_at = 0",
		)
			.bind(enabled ? 1 : 0, now, Number(id))
			.run();
		return this.getById(id);
	}

	async revoke(id, now = Date.now()) {
		await this.env.DB.prepare(
			`UPDATE api_tokens
			 SET is_enabled = 0, revoked_at = CASE WHEN revoked_at = 0 THEN ? ELSE revoked_at END,
			     updated_at = ?
			 WHERE id = ?`,
		)
			.bind(now, now, Number(id))
			.run();
		return this.getById(id);
	}

	async touchUsage(id, now = Date.now()) {
		await this.env.DB.prepare(
			`UPDATE api_tokens
			 SET last_used_at = ?, usage_count = usage_count + 1, updated_at = ?
			 WHERE id = ?`,
		)
			.bind(now, now, Number(id))
			.run();
	}
}
