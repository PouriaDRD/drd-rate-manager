import { APP } from "../config/app.js";
import { safeJson } from "../utils/core.js";

export class AdminInputRepository {
	constructor(env) {
		this.env = env;
	}

	async set(userId, action, payload = null) {
		const now = Date.now();
		await this.env.DB.prepare(`INSERT INTO admin_input_state
			(telegram_user_id, action, payload, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(telegram_user_id) DO UPDATE SET action = excluded.action, payload = excluded.payload, updated_at = excluded.updated_at`)
			.bind(String(userId), action, payload ? JSON.stringify(payload) : null, now, now)
			.run();
	}

	async get(userId) {
		const row = await this.env.DB.prepare(
			"SELECT * FROM admin_input_state WHERE telegram_user_id = ? LIMIT 1",
		).bind(String(userId)).first();
		if (!row) return null;
		if (Date.now() - Number(row.updated_at || 0) > APP.adminInputTtlMs) {
			await this.clear(userId);
			return null;
		}
		return { action: row.action, payload: safeJson(row.payload, null) };
	}

	async clear(userId) {
		await this.env.DB.prepare("DELETE FROM admin_input_state WHERE telegram_user_id = ?")
			.bind(String(userId))
			.run();
	}
}
