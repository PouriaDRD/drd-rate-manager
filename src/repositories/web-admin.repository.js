export class WebAdminRepository {
	constructor(env) {
		this.env = env;
	}

	async getPrimary() {
		return this.env.DB.prepare("SELECT * FROM web_admin_users ORDER BY id ASC LIMIT 1").first();
	}

	async getByUsername(username) {
		return this.env.DB.prepare("SELECT * FROM web_admin_users WHERE username = ? LIMIT 1")
			.bind(String(username))
			.first();
	}

	async createBootstrap(record) {
		const now = Date.now();
		await this.env.DB.prepare(`INSERT OR IGNORE INTO web_admin_users (
			id, username, password_hash, password_salt, password_algorithm, password_iterations,
			admin_path, must_complete_bootstrap, credential_version, last_login_at, created_at, updated_at
		) VALUES (1, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)`)
			.bind(
				record.username,
				record.passwordHash,
				record.passwordSalt,
				record.passwordAlgorithm,
				record.passwordIterations,
				record.adminPath,
				now,
				now,
			)
			.run();
		return this.getPrimary();
	}

	async completeBootstrap(userId, record) {
		const now = Date.now();
		await this.env.DB.prepare(`UPDATE web_admin_users SET
			username = ?, password_hash = ?, password_salt = ?, password_algorithm = ?,
			password_iterations = ?, admin_path = ?, must_complete_bootstrap = 0,
			credential_version = credential_version + 1, updated_at = ?
			WHERE id = ?`)
			.bind(
				record.username,
				record.passwordHash,
				record.passwordSalt,
				record.passwordAlgorithm,
				record.passwordIterations,
				record.adminPath,
				now,
				userId,
			)
			.run();
		return this.getPrimary();
	}

	async updateCredentials(userId, record) {
		const current = await this.getPrimary();
		if (!current || Number(current.id) !== Number(userId)) return null;
		const now = Date.now();
		await this.env.DB.prepare(`UPDATE web_admin_users SET
			username = ?, password_hash = ?, password_salt = ?, password_algorithm = ?,
			password_iterations = ?, admin_path = ?, credential_version = credential_version + 1,
			updated_at = ? WHERE id = ?`)
			.bind(
				record.username,
				record.passwordHash,
				record.passwordSalt,
				record.passwordAlgorithm,
				record.passwordIterations,
				record.adminPath,
				now,
				userId,
			)
			.run();
		return this.getPrimary();
	}

	async touchLogin(userId, now = Date.now()) {
		await this.env.DB.prepare("UPDATE web_admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?")
			.bind(now, now, userId)
			.run();
	}
}
