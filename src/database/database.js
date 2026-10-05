import { APP } from "../config/app.js";
import { Config } from "../config/config.js";
import { RUNTIME_SETTINGS_VERSION, runtimeSettingSeedValues } from "../config/runtime-settings.js";
import { AssetRepository } from "../repositories/asset.repository.js";

let bootstrapPromise = null;

/** D1 bootstrap and schema migration service. */
export class Database {
	constructor(env) {
		this.env = env;
		if (!env.DB) throw new Error('D1 binding "DB" is not configured.');
	}

	async ensureReady() {
		if (!bootstrapPromise) {
			bootstrapPromise = this.#bootstrap().catch((error) => {
				bootstrapPromise = null;
				throw error;
			});
		}
		return bootstrapPromise;
	}

	async #bootstrap() {
		const now = Date.now();
		await this.env.DB.batch([
			this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_meta (
				key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
			)`),
			this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS settings (
				key TEXT PRIMARY KEY, value TEXT NOT NULL,
				created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
			)`),
			this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS admins (
				user_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT,
				is_active INTEGER NOT NULL DEFAULT 1, added_by TEXT NOT NULL,
				created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0
			)`),
			this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS source_status (
				source TEXT PRIMARY KEY, success INTEGER NOT NULL DEFAULT 0,
				status_code INTEGER, latency_ms INTEGER, message TEXT, last_price REAL,
				last_checked_at INTEGER NOT NULL
			)`),
			this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_input_state (
				telegram_user_id TEXT PRIMARY KEY, action TEXT NOT NULL, payload TEXT,
				created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
			)`),
			this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_user_id TEXT,
				action TEXT NOT NULL, data TEXT, created_at INTEGER NOT NULL
			)`),
			this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS coingecko_assets (
				coin_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL,
				is_enabled INTEGER NOT NULL DEFAULT 0, market_cap_rank INTEGER,
				created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
			)`),
			this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_cache (
				cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL, last_error TEXT, updated_at INTEGER NOT NULL
			)`),
			this.env.DB.prepare(`CREATE TABLE IF NOT EXISTS runtime_locks (
				lock_key TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)`),
		]);

		await this.#ensureColumn("settings", "created_at", "INTEGER NOT NULL DEFAULT 0");
		await this.#ensureColumn("admins", "username", "TEXT");
		await this.#ensureColumn("admins", "first_name", "TEXT");
		await this.#ensureColumn("admins", "last_name", "TEXT");
		await this.#ensureColumn("admins", "is_active", "INTEGER NOT NULL DEFAULT 1");
		await this.#ensureColumn("admins", "updated_at", "INTEGER NOT NULL DEFAULT 0");

		const defaults = {
			bot_enabled: "1",
			auto_publish_enabled: "0",
			publish_interval_minutes: String(APP.defaultPublishIntervalMinutes),
			quiet_hours_enabled: "0",
			quiet_hours_start: APP.defaultQuietHours.start,
			quiet_hours_end: APP.defaultQuietHours.end,
			auto_publish_last_run_at: "0",
			auto_publish_last_success_at: "0",
			auto_publish_last_success_slot_at: "0",
			auto_publish_retry_slot_at: "0",
			auto_publish_last_error: "",
			auto_publish_last_tick_at: "0",
			auto_publish_last_attempt_at: "0",
			auto_publish_last_error_at: "0",
			auto_publish_last_skip_reason: "",
			market_cache_ttl_seconds: String(APP.defaultCacheTtlSeconds),
			...runtimeSettingSeedValues(this.env),
		};
		await this.env.DB.batch(
			Object.entries(defaults).map(([key, value]) =>
				this.env.DB.prepare(
					"INSERT OR IGNORE INTO settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)",
				).bind(key, value, now, now),
			),
		);

		await this.env.DB.prepare(`INSERT INTO app_meta (key, value, updated_at)
			VALUES ('schema_version', ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
			.bind(String(APP.schemaVersion), now)
			.run();

		await this.env.DB.prepare(`INSERT INTO app_meta (key, value, updated_at)
			VALUES ('runtime_settings_version', ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
			.bind(String(RUNTIME_SETTINGS_VERSION), now)
			.run();

		await new AssetRepository(this.env, new Config(this.env)).initializeDefaults();
	}

	async #ensureColumn(table, column, definition) {
		const allowed = new Set(["settings", "admins"]);
		if (!allowed.has(table)) throw new Error(`Invalid migration table: ${table}`);
		const info = await this.env.DB.prepare(`PRAGMA table_info("${table}")`).all();
		if ((info.results || []).some((row) => String(row.name) === column)) return;
		await this.env.DB.prepare(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`).run();
	}
}
