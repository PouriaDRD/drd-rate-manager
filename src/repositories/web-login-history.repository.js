const PUBLIC_COLUMNS = `id, user_id, username, result, reason, ip_address, user_agent,
	cf_ray, country, region, city, timezone, asn, session_ref, created_at`;

function boundedInteger(value, fallback, min, max) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

function mapRow(row) {
	return {
		id: Number(row.id),
		userId: row.user_id == null ? null : Number(row.user_id),
		username: String(row.username || ""),
		result: String(row.result || ""),
		reason: String(row.reason || ""),
		ipAddress: String(row.ip_address || ""),
		userAgent: String(row.user_agent || ""),
		cfRay: String(row.cf_ray || ""),
		country: String(row.country || ""),
		region: String(row.region || ""),
		city: String(row.city || ""),
		timezone: String(row.timezone || ""),
		asn: row.asn == null ? null : Number(row.asn),
		sessionRef: row.session_ref == null ? null : String(row.session_ref),
		createdAt: Number(row.created_at || 0),
	};
}

export class WebLoginHistoryRepository {
	constructor(env) {
		this.env = env;
	}

	async create(record) {
		const result = await this.env.DB.prepare(`INSERT INTO web_admin_login_history (
			user_id, username, result, reason, ip_address, user_agent,
			cf_ray, country, region, city, timezone, asn, session_ref, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
			.bind(
				record.userId,
				record.username,
				record.result,
				record.reason,
				record.ipAddress,
				record.userAgent,
				record.cfRay,
				record.country,
				record.region,
				record.city,
				record.timezone,
				record.asn,
				record.sessionRef,
				record.createdAt,
			)
			.run();
		const id = Number(result?.meta?.last_row_id || 0);
		return id > 0 ? this.getById(id) : null;
	}

	async getById(id) {
		const row = await this.env.DB.prepare(
			`SELECT ${PUBLIC_COLUMNS} FROM web_admin_login_history WHERE id = ? LIMIT 1`,
		)
			.bind(Number(id))
			.first();
		return row ? mapRow(row) : null;
	}

	async list({ limit = 50, offset = 0, result = null } = {}) {
		const safeLimit = boundedInteger(limit, 50, 1, 100);
		const safeOffset = boundedInteger(offset, 0, 0, 100_000);
		const normalizedResult = result == null ? null : String(result).trim().toLowerCase();
		const query = normalizedResult
			? `SELECT ${PUBLIC_COLUMNS} FROM web_admin_login_history
				WHERE result = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
			: `SELECT ${PUBLIC_COLUMNS} FROM web_admin_login_history
				ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
		const statement = this.env.DB.prepare(query);
		const response = normalizedResult
			? await statement.bind(normalizedResult, safeLimit, safeOffset).all()
			: await statement.bind(safeLimit, safeOffset).all();
		return (response.results || []).map(mapRow);
	}

	async stats() {
		const [total, success, failure, locked] = await Promise.all([
			this.#count(),
			this.#count("success"),
			this.#count("failure"),
			this.#count("locked"),
		]);
		return { total, success, failure, locked };
	}

	async #count(result = null) {
		const row = result
			? await this.env.DB.prepare(
					"SELECT COUNT(*) AS count FROM web_admin_login_history WHERE result = ?",
				)
					.bind(result)
					.first()
			: await this.env.DB.prepare(
					"SELECT COUNT(*) AS count FROM web_admin_login_history",
				).first();
		return Number(row?.count || 0);
	}
}
