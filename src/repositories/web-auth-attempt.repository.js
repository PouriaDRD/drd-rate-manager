export class WebAuthAttemptRepository {
	constructor(env) {
		this.env = env;
	}

	async get(key) {
		return this.env.DB.prepare("SELECT * FROM web_auth_attempts WHERE attempt_key = ? LIMIT 1")
			.bind(key)
			.first();
	}

	async recordFailure(key, now, { windowMs, maxFailures, lockMs }) {
		const current = await this.get(key);
		let failures = 1;
		let windowStartedAt = now;
		if (current && now - Number(current.window_started_at || 0) <= windowMs) {
			failures = Number(current.failure_count || 0) + 1;
			windowStartedAt = Number(current.window_started_at || now);
		}
		const lockedUntil = failures >= maxFailures ? now + lockMs : 0;
		await this.env.DB.prepare(`INSERT INTO web_auth_attempts (
			attempt_key, failure_count, window_started_at, locked_until, updated_at
		) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(attempt_key) DO UPDATE SET
			failure_count = excluded.failure_count,
			window_started_at = excluded.window_started_at,
			locked_until = excluded.locked_until,
			updated_at = excluded.updated_at`)
			.bind(key, failures, windowStartedAt, lockedUntil, now)
			.run();
		return { failures, lockedUntil };
	}

	async clear(key) {
		await this.env.DB.prepare("DELETE FROM web_auth_attempts WHERE attempt_key = ?")
			.bind(key)
			.run();
	}

	async prune(before) {
		await this.env.DB.prepare("DELETE FROM web_auth_attempts WHERE updated_at < ?")
			.bind(before)
			.run();
	}
}
