import { errorMessage } from "../utils/core.js";

export class LockRepository {
	constructor(env) {
		this.env = env;
	}

	async acquire(key, ttlMs) {
		const attempt = async () => {
			const now = Date.now();
			const token = crypto.randomUUID();
			const result = await this.env.DB.prepare(`INSERT INTO runtime_locks (lock_key, token, expires_at, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(lock_key) DO UPDATE SET
					token = excluded.token,
					expires_at = excluded.expires_at,
					updated_at = excluded.updated_at
				WHERE runtime_locks.expires_at <= ?`)
				.bind(key, token, now + ttlMs, now, now)
				.run();
			return Number(result?.meta?.changes || 0) > 0 ? token : null;
		};
		try {
			return await attempt();
		} catch (error) {
			if (!errorMessage(error).toLowerCase().includes("no such table")) throw error;
			await this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS runtime_locks (
				lock_key TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
			)`).run();
			return attempt();
		}
	}

	async release(key, token) {
		try {
			await this.env.DB.prepare("DELETE FROM runtime_locks WHERE lock_key = ? AND token = ?")
				.bind(key, token)
				.run();
		} catch (error) {
			console.warn("lock.release_failed", errorMessage(error));
		}
	}
}
