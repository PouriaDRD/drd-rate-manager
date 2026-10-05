import { errorMessage } from "../utils/core.js";

export class AuditRepository {
	constructor(env) {
		this.env = env;
	}

	async add(userId, action, data = null) {
		try {
			await this.env.DB.prepare(
				"INSERT INTO audit_logs (telegram_user_id, action, data, created_at) VALUES (?, ?, ?, ?)",
			)
				.bind(userId == null ? null : String(userId), action, data ? JSON.stringify(data) : null, Date.now())
				.run();
		} catch (error) {
			console.warn("audit.write_failed", errorMessage(error));
		}
	}
}
