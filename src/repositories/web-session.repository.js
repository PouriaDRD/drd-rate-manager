export class WebSessionRepository {
	constructor(env) {
		this.env = env;
	}

	async create(record) {
		await this.env.DB.prepare(`INSERT INTO web_admin_sessions (
			token_hash, user_id, csrf_hash, credential_version, created_at, last_seen_at,
			expires_at, ip_hash, user_agent
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
			.bind(
				record.tokenHash,
				record.userId,
				record.csrfHash,
				record.credentialVersion,
				record.createdAt,
				record.lastSeenAt,
				record.expiresAt,
				record.ipHash,
				record.userAgent,
			)
			.run();
	}

	async get(tokenHash) {
		return this.env.DB.prepare("SELECT * FROM web_admin_sessions WHERE token_hash = ? LIMIT 1")
			.bind(tokenHash)
			.first();
	}

	async touch(tokenHash, now) {
		await this.env.DB.prepare("UPDATE web_admin_sessions SET last_seen_at = ? WHERE token_hash = ?")
			.bind(now, tokenHash)
			.run();
	}

	async rotateCsrf(tokenHash, csrfHash) {
		await this.env.DB.prepare("UPDATE web_admin_sessions SET csrf_hash = ? WHERE token_hash = ?")
			.bind(csrfHash, tokenHash)
			.run();
	}

	async remove(tokenHash) {
		await this.env.DB.prepare("DELETE FROM web_admin_sessions WHERE token_hash = ?")
			.bind(tokenHash)
			.run();
	}

	async removeAllForUser(userId) {
		await this.env.DB.prepare("DELETE FROM web_admin_sessions WHERE user_id = ?")
			.bind(userId)
			.run();
	}

	async pruneExpired(now = Date.now()) {
		await this.env.DB.prepare("DELETE FROM web_admin_sessions WHERE expires_at <= ?")
			.bind(now)
			.run();
	}
}
