import { APP } from "../config/app.js";
import { errorMessage } from "../utils/core.js";

export class MarketCacheRepository {
	constructor(env) {
		this.env = env;
	}

	async #ensureTable() {
		await this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_cache (
			cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL, last_error TEXT, updated_at INTEGER NOT NULL
		)`).run();
	}

	async read(key = APP.marketCacheKey) {
		let row;
		try {
			row = await this.env.DB.prepare(`SELECT payload, fetched_at, expires_at, last_error
				FROM market_cache WHERE cache_key = ? LIMIT 1`)
				.bind(key)
				.first();
		} catch (error) {
			if (!errorMessage(error).toLowerCase().includes("no such table")) throw error;
			await this.#ensureTable();
			return null;
		}
		if (!row?.payload) return null;
		try {
			return {
				payload: JSON.parse(row.payload),
				fetchedAt: Number(row.fetched_at || 0),
				expiresAt: Number(row.expires_at || 0),
				lastError: row.last_error || null,
			};
		} catch {
			return null;
		}
	}

	async write(payload, ttlSeconds, lastError = null, key = APP.marketCacheKey) {
		const fetchedAt = Date.now();
		const expiresAt = fetchedAt + ttlSeconds * 1000;
		const write = () => this.env.DB.prepare(`INSERT INTO market_cache
			(cache_key, payload, fetched_at, expires_at, last_error, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(cache_key) DO UPDATE SET
				payload = excluded.payload,
				fetched_at = excluded.fetched_at,
				expires_at = excluded.expires_at,
				last_error = excluded.last_error,
				updated_at = excluded.updated_at`)
			.bind(key, JSON.stringify(payload), fetchedAt, expiresAt, lastError, fetchedAt)
			.run();
		try {
			await write();
		} catch (error) {
			if (!errorMessage(error).toLowerCase().includes("no such table")) throw error;
			await this.#ensureTable();
			await write();
		}
		return { fetchedAt, expiresAt };
	}
}
