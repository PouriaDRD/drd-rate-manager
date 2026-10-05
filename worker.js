/**
 * ============================================================
 * DRD RATE MANAGER
 * Version: 0.13.0
 * Runtime: Cloudflare Workers
 * Database: Cloudflare D1
 * Architecture: Repository + Service + Controller
 *
 * Recommended Cloudflare Cron:
 *
 *     * * * * *
 *
 * ============================================================
 */

/**
 * Application metadata and stable defaults.
 * Keep deployment-specific values in environment variables.
 */
const APP = Object.freeze({
	name: "DRD RATE MANAGER",
	displayName: "DRD Rate Manager",
	version: "0.13.0",
	schemaVersion: 8,
	apiVersion: "v1",
	defaultCacheTtlSeconds: 30,
	defaultPublishIntervalMinutes: 10,
	cacheTtlOptions: [5, 10, 15, 30, 60, 120, 300, 600],
	publishIntervals: [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
	quietMinuteOptions: [0, 15, 30, 45],
	defaultQuietHours: { enabled: false, start: "01:00", end: "10:30" },
	adminInputTtlMs: 10 * 60 * 1000,
	marketCacheKey: "market_snapshot",
	marketRefreshLockKey: "market_refresh",
	marketRefreshLockMs: 15_000,
});

const COIN_NAMES_FA = Object.freeze({
	bitcoin: "بیت‌کوین",
	ethereum: "اتریوم",
	tether: "تتر",
	binancecoin: "بایننس‌کوین",
	ripple: "ریپل",
	solana: "سولانا",
	"usd-coin": "یو‌اس‌دی کوین",
	dogecoin: "دوج‌کوین",
	cardano: "کاردانو",
	tron: "ترون",
	chainlink: "چین‌لینک",
	avalanche: "آوالانچ",
	stellar: "استلار",
	"shiba-inu": "شیبا اینو",
	sui: "سویی",
	toncoin: "تون‌کوین",
	polkadot: "پولکادات",
	litecoin: "لایت‌کوین",
	"bitcoin-cash": "بیت‌کوین کش",
	hedera: "هدرا",
	hyperliquid: "هایپرلیکویید",
	monero: "مونرو",
	pepe: "پپه",
	uniswap: "یونی‌سواپ",
	aave: "آوه",
	aptos: "آپتوس",
	near: "نیر",
	"internet-computer": "اینترنت کامپیوتر",
	"crypto-com-chain": "کرونوس",
	vechain: "وی‌چین",
	"matic-network": "پالیگان",
	"wrapped-bitcoin": "بیت‌کوین رپد",
	dai: "دای",
	okb: "اوکی‌بی",
	mantle: "منتل",
	bittensor: "بیت‌تنسور",
	"render-token": "رندر",
	filecoin: "فایل‌کوین",
	cosmos: "کازمس",
	arbitrum: "آربیتروم",
	optimism: "آپتیمیزم",
	"injective-protocol": "اینجکتیو",
});

const USDT_SOURCE_PRIORITY = Object.freeze(["wallex", "tabdeal", "exir"]);

let bootstrapPromise = null;
let telegramSyncPromise = null;
const dateTimeFormatterCache = new Map();

const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const priceLargeFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 2,
	minimumFractionDigits: 0,
});
const priceSmallFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 4,
	minimumFractionDigits: 0,
});

/** Environment configuration facade. */
class Config {
	constructor(env) {
		this.env = env;
	}

	get version() {
		return String(this.env.APP_VERSION || APP.version);
	}

	get timezone() {
		return String(this.env.TIMEZONE || "Asia/Tehran");
	}

	get displayName() {
		return String(this.env.BOT_DISPLAY_NAME || APP.displayName);
	}

	get channelId() {
		return this.env.TELEGRAM_CHANNEL_ID || null;
	}

	get channelHandle() {
		const value = String(this.env.TELEGRAM_CHANNEL_HANDLE || "").trim();
		if (!value) return "";
		return value.startsWith("@") ? value : `@${value}`;
	}

	get ownerId() {
		return String(this.env.TELEGRAM_OWNER_ID || "").trim();
	}

	get coinGeckoPlan() {
		return String(this.env.COINGECKO_API_PLAN || "demo").toLowerCase() === "pro"
			? "pro"
			: "demo";
	}

	get coinGeckoBaseUrl() {
		return this.coinGeckoPlan === "pro"
			? "https://pro-api.coingecko.com/api/v3"
			: "https://api.coingecko.com/api/v3";
	}

	coinGeckoHeaders() {
		const headers = {
			Accept: "application/json",
			"User-Agent": String(
				this.env.COINGECKO_USER_AGENT ||
					`DRD-Rate-Manager/${this.version} (+https://t.me/${this.channelHandle.replace(/^@/, "") || "DRDrate"})`,
			),
		};
		if (this.env.COINGECKO_API_KEY) {
			headers[this.coinGeckoPlan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] =
				this.env.COINGECKO_API_KEY;
		}
		return headers;
	}

	get coinGeckoTopLimit() {
		const raw = Number(this.env.COINGECKO_TOP_LIMIT || 20);
		return Number.isFinite(raw) ? Math.min(50, Math.max(10, Math.floor(raw))) : 20;
	}

	get defaultCoinGeckoAssets() {
		const configured = String(this.env.COINGECKO_DEFAULT_ASSETS || "")
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
		return configured.length ? configured : ["bitcoin", "ethereum", "binancecoin", "ripple", "solana", "tron"];
	}
}

/** D1 bootstrap and schema migration service. */
class Database {
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
			auto_publish_last_error: "",
			auto_publish_last_tick_at: "0",
			auto_publish_last_attempt_at: "0",
			auto_publish_last_error_at: "0",
			auto_publish_last_skip_reason: "",
			market_cache_ttl_seconds: String(APP.defaultCacheTtlSeconds),
		};
		await this.env.DB.batch(
			Object.entries(defaults).map(([key, value]) =>
				this.env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`)
					.bind(key, value, now, now),
			),
		);

		await this.env.DB.prepare(`INSERT INTO app_meta (key, value, updated_at)
			VALUES ('schema_version', ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
			.bind(String(APP.schemaVersion), now).run();

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

/** Generic settings repository. */
class SettingsRepository {
	constructor(env) { this.env = env; }

	async get(key, fallback = null) {
		const row = await this.env.DB.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").bind(key).first();
		return row?.value ?? fallback;
	}

	async getMany(keys) {
		if (!keys.length) return {};
		const placeholders = keys.map(() => "?").join(",");
		const result = await this.env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`).bind(...keys).all();
		return Object.fromEntries((result.results || []).map((row) => [row.key, row.value]));
	}

	async set(key, value) {
		const now = Date.now();
		await this.env.DB.prepare(`INSERT INTO settings (key, value, created_at, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
			.bind(key, String(value), now, now).run();
	}

	async setMany(values) {
		const now = Date.now();
		const statements = Object.entries(values).map(([key, value]) =>
			this.env.DB.prepare(`INSERT INTO settings (key, value, created_at, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
				.bind(key, String(value ?? ""), now, now),
		);
		if (statements.length) await this.env.DB.batch(statements);
	}
}

/** Persistent market snapshot cache. */
class MarketCacheRepository {
	constructor(env) { this.env = env; }

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
				FROM market_cache WHERE cache_key = ? LIMIT 1`).bind(key).first();
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
			.bind(key, JSON.stringify(payload), fetchedAt, expiresAt, lastError, fetchedAt).run();
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

/** D1-backed distributed lock used to avoid duplicate source refreshes across isolates. */
class LockRepository {
	constructor(env) { this.env = env; }

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
				.bind(key, token, now + ttlMs, now, now).run();
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
			await this.env.DB.prepare("DELETE FROM runtime_locks WHERE lock_key = ? AND token = ?").bind(key, token).run();
		} catch (error) {
			console.warn("lock.release_failed", errorMessage(error));
		}
	}
}

/** Latest source-health persistence. */
class SourceStatusRepository {
	constructor(env) { this.env = env; }

	async save(source, status) {
		await this.env.DB.prepare(`INSERT INTO source_status
			(source, success, status_code, latency_ms, message, last_price, last_checked_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(source) DO UPDATE SET
				success = excluded.success,
				status_code = excluded.status_code,
				latency_ms = excluded.latency_ms,
				message = excluded.message,
				last_price = excluded.last_price,
				last_checked_at = excluded.last_checked_at`)
			.bind(
				source,
				status.success ? 1 : 0,
				status.status ?? null,
				status.latency ?? null,
				status.message ?? null,
				status.price ?? null,
				Date.now(),
			).run();
	}

	async saveMany(map) {
		for (const [name, status] of Object.entries(map)) await this.save(name, status);
	}

	async all() {
		const result = await this.env.DB.prepare(`SELECT source, success, status_code, latency_ms,
			message, last_price, last_checked_at FROM source_status`).all();
		const map = {};
		for (const row of result.results || []) {
			map[row.source] = {
				success: Number(row.success) === 1,
				status: row.status_code ?? null,
				latency: row.latency_ms ?? null,
				message: row.message ?? null,
				price: row.last_price ?? null,
				lastCheckedAt: Number(row.last_checked_at || 0),
			};
		}
		for (const source of ["wallex", "tabdeal", "exir", "coingecko", "wallgold"]) {
			if (!map[source]) map[source] = { success: false, status: null, latency: null, message: "No cached data yet", price: null, lastCheckedAt: 0 };
		}
		return map;
	}
}

/** CoinGecko asset-selection persistence. */
class AssetRepository {
	constructor(env, config) { this.env = env; this.config = config; }

	async initializeDefaults() {
		const row = await this.env.DB.prepare("SELECT COUNT(*) AS count FROM coingecko_assets").first();
		if (Number(row?.count || 0) > 0) return;
		const now = Date.now();
		const statements = this.config.defaultCoinGeckoAssets.map((coinId) =>
			this.env.DB.prepare(`INSERT OR IGNORE INTO coingecko_assets
				(coin_id, symbol, name, is_enabled, market_cap_rank, created_at, updated_at)
				VALUES (?, ?, ?, 1, NULL, ?, ?)`)
				.bind(coinId, coinId.toUpperCase(), coinId, now, now),
		);
		if (statements.length) await this.env.DB.batch(statements);
	}

	async enabled() {
		const result = await this.env.DB.prepare(`SELECT coin_id, symbol, name, market_cap_rank
			FROM coingecko_assets WHERE is_enabled = 1
			ORDER BY CASE WHEN market_cap_rank IS NULL THEN 999999 ELSE market_cap_rank END ASC`).all();
		return result.results || [];
	}

	async all() {
		const result = await this.env.DB.prepare(`SELECT coin_id, symbol, name, market_cap_rank, is_enabled
			FROM coingecko_assets
			ORDER BY CASE WHEN market_cap_rank IS NULL THEN 999999 ELSE market_cap_rank END ASC`).all();
		return (result.results || []).map((row) => ({
			id: row.coin_id,
			name: row.name,
			name_fa: coinNameFa(row.coin_id, row.name),
			symbol: row.symbol,
			market_cap_rank: row.market_cap_rank ?? null,
			enabled: Number(row.is_enabled) === 1,
		}));
	}

	async toggle(coinId) {
		const row = await this.env.DB.prepare("SELECT is_enabled FROM coingecko_assets WHERE coin_id = ? LIMIT 1").bind(coinId).first();
		if (!row) throw new Error("Asset not found");
		const next = Number(row.is_enabled) === 1 ? 0 : 1;
		await this.env.DB.prepare("UPDATE coingecko_assets SET is_enabled = ?, updated_at = ? WHERE coin_id = ?")
			.bind(next, Date.now(), coinId).run();
		return next === 1;
	}

	async syncTopAssets(assets) {
		const current = new Map((await this.all()).map((item) => [item.id, item]));
		const defaults = new Set(this.config.defaultCoinGeckoAssets);
		const now = Date.now();
		const statements = assets.map((asset) => {
			const existing = current.get(asset.id);
			const enabled = existing ? (existing.enabled ? 1 : 0) : defaults.has(asset.id) ? 1 : 0;
			return this.env.DB.prepare(`INSERT INTO coingecko_assets
				(coin_id, symbol, name, is_enabled, market_cap_rank, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(coin_id) DO UPDATE SET
					symbol = excluded.symbol,
					name = excluded.name,
					market_cap_rank = excluded.market_cap_rank,
					updated_at = excluded.updated_at`)
				.bind(asset.id, asset.symbol, asset.name, enabled, asset.marketCapRank ?? null, now, now);
		});
		if (statements.length) await this.env.DB.batch(statements);
	}
}

/** Administrator persistence. Owner identity remains environment-based. */
class AdminRepository {
	constructor(env, config) { this.env = env; this.config = config; }

	isOwner(userId) { return String(userId) === this.config.ownerId && Boolean(this.config.ownerId); }

	async resolve(user) {
		if (!user?.id) return null;
		if (this.isOwner(user.id)) return { role: "owner", active: true, userId: String(user.id), user };
		const row = await this.env.DB.prepare("SELECT * FROM admins WHERE user_id = ? LIMIT 1").bind(String(user.id)).first();
		if (!row || Number(row.is_active) !== 1) return null;
		return { role: "admin", active: true, userId: String(user.id), row, user };
	}

	async touchProfile(user) {
		if (!user?.id || this.isOwner(user.id)) return;
		await this.env.DB.prepare(`UPDATE admins SET username = ?, first_name = ?, last_name = ?, updated_at = ? WHERE user_id = ?`)
			.bind(user.username || null, user.first_name || null, user.last_name || null, Date.now(), String(user.id)).run();
	}

	async list() {
		const result = await this.env.DB.prepare("SELECT * FROM admins ORDER BY created_at ASC").all();
		return result.results || [];
	}

	async get(userId) {
		return this.env.DB.prepare("SELECT * FROM admins WHERE user_id = ? LIMIT 1").bind(String(userId)).first();
	}

	async add(userId, addedBy) {
		const now = Date.now();
		await this.env.DB.prepare(`INSERT INTO admins
			(user_id, username, first_name, last_name, is_active, added_by, created_at, updated_at)
			VALUES (?, NULL, NULL, NULL, 1, ?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET is_active = 1, updated_at = excluded.updated_at`)
			.bind(String(userId), String(addedBy), now, now).run();
	}

	async toggle(userId) {
		const row = await this.get(userId);
		if (!row) throw new Error("Admin not found");
		const next = Number(row.is_active) === 1 ? 0 : 1;
		await this.env.DB.prepare("UPDATE admins SET is_active = ?, updated_at = ? WHERE user_id = ?")
			.bind(next, Date.now(), String(userId)).run();
		return next === 1;
	}

	async remove(userId) {
		await this.env.DB.prepare("DELETE FROM admins WHERE user_id = ?").bind(String(userId)).run();
	}

	async stats() {
		const rows = await this.list();
		return {
			total: rows.length + (this.config.ownerId ? 1 : 0),
			active_admins: rows.filter((row) => Number(row.is_active) === 1).length,
			inactive_admins: rows.filter((row) => Number(row.is_active) !== 1).length,
			owner_configured: Boolean(this.config.ownerId),
		};
	}
}

/** Temporary admin-input state. */
class AdminInputRepository {
	constructor(env) { this.env = env; }

	async set(userId, action, payload = null) {
		const now = Date.now();
		await this.env.DB.prepare(`INSERT INTO admin_input_state
			(telegram_user_id, action, payload, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(telegram_user_id) DO UPDATE SET action = excluded.action, payload = excluded.payload, updated_at = excluded.updated_at`)
			.bind(String(userId), action, payload ? JSON.stringify(payload) : null, now, now).run();
	}

	async get(userId) {
		const row = await this.env.DB.prepare("SELECT * FROM admin_input_state WHERE telegram_user_id = ? LIMIT 1").bind(String(userId)).first();
		if (!row) return null;
		if (Date.now() - Number(row.updated_at || 0) > APP.adminInputTtlMs) {
			await this.clear(userId);
			return null;
		}
		return { action: row.action, payload: safeJson(row.payload, null) };
	}

	async clear(userId) {
		await this.env.DB.prepare("DELETE FROM admin_input_state WHERE telegram_user_id = ?").bind(String(userId)).run();
	}
}

/** Best-effort audit logger; audit failure never breaks the business flow. */
class AuditRepository {
	constructor(env) { this.env = env; }
	async add(userId, action, data = null) {
		try {
			await this.env.DB.prepare(`INSERT INTO audit_logs (telegram_user_id, action, data, created_at) VALUES (?, ?, ?, ?)`)
				.bind(userId == null ? null : String(userId), action, data ? JSON.stringify(data) : null, Date.now()).run();
		} catch (error) {
			console.warn("audit.write_failed", errorMessage(error));
		}
	}
}

/** Timeout-aware HTTP client with compact source errors. */
class HttpClient {
	async fetch(url, init = {}, timeoutMs = 8000) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(url, { ...init, signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
	}

	async sourceError(response) {
		let text = "";
		try { text = await response.text(); } catch { /* ignore */ }
		text = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
		return `HTTP ${response.status}${text ? `: ${text}` : ""}`;
	}
}

/**
 * CoinGecko client.
 * A market refresh performs exactly ONE CoinGecko request for both
 * selected cryptocurrencies and metal proxy assets.
 */
class CoinGeckoClient {
	constructor(env, config, http) {
		this.env = env;
		this.config = config;
		this.http = http;
	}

	async fetchMarketBundle(enabledAssets) {
		if (!this.env.COINGECKO_API_KEY) return failure("COINGECKO_API_KEY missing");
		const ids = [...new Set([
			...enabledAssets.map((item) => item.coin_id),
			"tether-gold",
			"kinesis-silver",
		])];
		const endpoint = `${this.config.coinGeckoBaseUrl}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`;
		const startedAt = Date.now();
		try {
			const response = await this.http.fetch(endpoint, { headers: this.config.coinGeckoHeaders() }, 8000);
			const latency = Date.now() - startedAt;
			if (!response.ok) return failure(await this.http.sourceError(response), response.status, latency);
			const data = await response.json();
			if (!Array.isArray(data)) return failure("Invalid CoinGecko response", response.status, latency);
			const map = new Map(data.map((item) => [String(item.id), item]));
			const crypto = enabledAssets.map((stored) => {
				const live = map.get(stored.coin_id);
				return {
					id: stored.coin_id,
					symbol: String(live?.symbol || stored.symbol || "").toUpperCase(),
					name: String(live?.name || stored.name || stored.coin_id),
					price: nullableNumber(live?.current_price),
					change24h: nullableNumber(live?.price_change_percentage_24h),
					marketCapRank: nullableNumber(live?.market_cap_rank ?? stored.market_cap_rank),
				};
			});
			return {
				success: true,
				status: response.status,
				latency,
				crypto,
				gold: nullableNumber(map.get("tether-gold")?.current_price),
				silver: nullableNumber(map.get("kinesis-silver")?.current_price),
			};
		} catch (error) {
			return failure(errorMessage(error), null, Date.now() - startedAt);
		}
	}

	async fetchTopAssets() {
		if (!this.env.COINGECKO_API_KEY) return failure("COINGECKO_API_KEY missing");
		const endpoint = `${this.config.coinGeckoBaseUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${this.config.coinGeckoTopLimit}&page=1&sparkline=false&price_change_percentage=24h`;
		const startedAt = Date.now();
		try {
			const response = await this.http.fetch(endpoint, { headers: this.config.coinGeckoHeaders() }, 8000);
			const latency = Date.now() - startedAt;
			if (!response.ok) return failure(await this.http.sourceError(response), response.status, latency);
			const data = await response.json();
			if (!Array.isArray(data)) return failure("Invalid CoinGecko response", response.status, latency);
			return {
				success: true,
				status: response.status,
				latency,
				assets: data.map((item) => ({
					id: String(item.id),
					symbol: String(item.symbol || "").toUpperCase(),
					name: String(item.name || item.id),
					marketCapRank: nullableNumber(item.market_cap_rank),
				})),
			};
		} catch (error) {
			return failure(errorMessage(error), null, Date.now() - startedAt);
		}
	}
}

/** Market source clients for USDT and Iranian gold. */
class MarketSources {
	constructor(env, http, statuses) {
		this.env = env;
		this.http = http;
		this.statuses = statuses;
	}

	async resolveUsdt() {
		for (let index = 0; index < USDT_SOURCE_PRIORITY.length; index += 1) {
			const source = USDT_SOURCE_PRIORITY[index];
			const result = await this[`check${capitalize(source)}`]();
			await this.statuses.save(source, result);
			if (result.success) {
				return { ...result, source, sourceLabel: sourceLabel(source), fallbackLevel: index };
			}
		}
		return failure("All USDT sources failed");
	}

	async checkAllUsdt() {
		const [wallex, tabdeal, exir] = await Promise.all([
			this.checkWallex(), this.checkTabdeal(), this.checkExir(),
		]);
		await this.statuses.saveMany({ wallex, tabdeal, exir });
		return { wallex, tabdeal, exir };
	}

	async checkWallex() {
		return this.#timed("wallex", async () => {
			const url = this.env.WALLEX_API_URL || "https://api.wallex.ir/hector/web/v1/markets";
			const response = await this.http.fetch(url, { headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } }, 7000);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const markets = data?.result?.markets;
			const market = Array.isArray(markets) ? markets.find((item) => String(item.symbol || "").toUpperCase() === "USDTTMN") : null;
			const price = nullableNumber(market?.price);
			return price && price > 0 ? success(price, response.status) : failure("Invalid Wallex response", response.status);
		});
	}

	async checkTabdeal() {
		return this.#timed("tabdeal", async () => {
			const url = this.env.TABDEAL_API_URL || "https://api1.tabdeal.org/r/api/v1/depth?symbol=USDTIRT&limit=1";
			const response = await this.http.fetch(url, { headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } }, 7000);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const price = nullableNumber(data?.asks?.[0]?.[0]);
			return price && price > 0 ? success(price, response.status) : failure("Invalid Tabdeal response", response.status);
		});
	}

	async checkExir() {
		return this.#timed("exir", async () => {
			const url = this.env.EXIR_API_URL || "https://api.exir.io/v2/orderbook?symbol=usdt-irt";
			const response = await this.http.fetch(url, { headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } }, 7000);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const price = nullableNumber(data?.asks?.[0]?.[0] ?? data?.ask?.[0]?.price ?? data?.asks?.[0]?.price);
			return price && price > 0 ? success(price, response.status) : failure("Invalid Exir response", response.status);
		});
	}

	async checkWallGold() {
		const result = await this.#timed("wallgold", async () => {
			const url = this.env.WALLGOLD_API_URL || "https://api.wallgold.ir/api/v1/price?side=buy&symbol=GLD_18C_750TMN";
			const response = await this.http.fetch(url, { headers: { Accept: "application/json", "User-Agent": `DRD-Rate-Manager/${APP.version}` } }, 7000);
			if (!response.ok) return failure(await this.http.sourceError(response), response.status);
			const data = await response.json();
			const price = nullableNumber(data?.result?.price);
			return price && price > 0 ? success(price, response.status) : failure("Invalid WallGold response", response.status);
		});
		await this.statuses.save("wallgold", result);
		return result;
	}

	async #timed(_source, operation) {
		const startedAt = Date.now();
		try {
			const result = await operation();
			return { ...result, latency: Date.now() - startedAt };
		} catch (error) {
			return failure(errorMessage(error), null, Date.now() - startedAt);
		}
	}
}

/** Central market cache/read-through service used by Bot, API and Cron. */
class MarketService {
	constructor(env, config, settings, cache, locks, assets, statuses, sources, coinGecko) {
		Object.assign(this, { env, config, settings, cache, locks, assets, statuses, sources, coinGecko });
	}

	async cacheTtlSeconds() {
		const raw = Number(await this.settings.get("market_cache_ttl_seconds", APP.defaultCacheTtlSeconds));
		return Number.isFinite(raw) ? Math.min(3600, Math.max(5, Math.round(raw))) : APP.defaultCacheTtlSeconds;
	}

	async getSnapshot({ forceRefresh = false, fullSourceCheck = false } = {}) {
		const ttlSeconds = await this.cacheTtlSeconds();
		const cached = await this.cache.read();
		const now = Date.now();
		if (!forceRefresh && cached && now < cached.expiresAt) {
			return this.#withCacheMeta(cached.payload, cached, ttlSeconds, true, false);
		}

		const token = await this.locks.acquire(APP.marketRefreshLockKey, APP.marketRefreshLockMs);
		if (!token) {
			if (cached) return this.#withCacheMeta(cached.payload, cached, ttlSeconds, true, true, "refresh_in_progress");
			await sleep(150);
			const retry = await this.cache.read();
			if (retry) return this.#withCacheMeta(retry.payload, retry, ttlSeconds, true, false);
			throw new Error("Market refresh is already in progress");
		}

		try {
			const fresh = await this.#fetchLive(fullSourceCheck);
			const merged = this.#mergeStale(fresh, cached?.payload || null);
			const lastError = fresh.partial
				? fresh.errors.map((item) => `${item.source}: ${item.message}`).join(" | ").slice(0, 1000)
				: null;
			const meta = await this.cache.write(merged, ttlSeconds, lastError);
			return this.#withCacheMeta(merged, { ...meta, lastError }, ttlSeconds, false, fresh.partial && Boolean(cached));
		} catch (error) {
			if (cached) return this.#withCacheMeta(cached.payload, cached, ttlSeconds, true, true, errorMessage(error));
			throw error;
		} finally {
			await this.locks.release(APP.marketRefreshLockKey, token);
		}
	}

	async forceRefreshSources() {
		await this.getSnapshot({ forceRefresh: true, fullSourceCheck: true });
		return this.statuses.all();
	}

	async #fetchLive(fullSourceCheck = false) {
		const enabledAssets = await this.assets.enabled();
		const [usdtResult, coinGecko, wallgold] = await Promise.all([
			fullSourceCheck ? this.sources.checkAllUsdt() : this.sources.resolveUsdt(),
			this.coinGecko.fetchMarketBundle(enabledAssets),
			this.sources.checkWallGold(),
		]);
		const usdt = fullSourceCheck ? resolveUsdtChecks(usdtResult) : usdtResult;
		await this.statuses.save("coingecko", coinGecko.success
			? { success: true, status: coinGecko.status, latency: coinGecko.latency, message: null, price: null }
			: coinGecko);

		const errors = [];
		if (!usdt.success) errors.push({ source: "usdt", message: usdt.message || "USDT unavailable" });
		if (!coinGecko.success) errors.push({ source: "coingecko", message: coinGecko.message || "CoinGecko unavailable" });
		if (!wallgold.success) errors.push({ source: "wallgold", message: wallgold.message || "WallGold unavailable" });

		return {
			success: true,
			partial: errors.length > 0,
			errors,
			createdAt: Date.now(),
			usdt: {
				price: usdt.success ? usdt.price : null,
				source: usdt.success ? usdt.sourceLabel : null,
				fallbackLevel: usdt.success ? usdt.fallbackLevel : null,
			},
			crypto: coinGecko.success
				? coinGecko.crypto
				: enabledAssets.map((item) => ({
					id: item.coin_id, symbol: item.symbol, name: item.name,
					price: null, change24h: null, marketCapRank: item.market_cap_rank ?? null,
				})),
			metals: {
				gram18: wallgold.success ? wallgold.price : null,
				mazaneh: wallgold.success ? calculateMazanehFromGram18(wallgold.price) : null,
				gold: coinGecko.success ? coinGecko.gold : null,
				silver: coinGecko.success ? coinGecko.silver : null,
			},
		};
	}

	#mergeStale(fresh, stale) {
		if (!stale) return fresh;
		const staleCrypto = new Map((stale.crypto || []).map((coin) => [coin.id, coin]));
		return {
			...fresh,
			usdt: {
				...fresh.usdt,
				price: fresh.usdt.price ?? stale.usdt?.price ?? null,
				source: fresh.usdt.source ?? stale.usdt?.source ?? null,
				fallbackLevel: fresh.usdt.fallbackLevel ?? stale.usdt?.fallbackLevel ?? null,
			},
			crypto: (fresh.crypto || []).map((coin) => {
				const previous = staleCrypto.get(coin.id);
				return {
					...coin,
					price: coin.price ?? previous?.price ?? null,
					change24h: coin.change24h ?? previous?.change24h ?? null,
				};
			}),
			metals: {
				gram18: fresh.metals?.gram18 ?? stale.metals?.gram18 ?? null,
				mazaneh: fresh.metals?.mazaneh ?? stale.metals?.mazaneh ?? null,
				gold: fresh.metals?.gold ?? stale.metals?.gold ?? null,
				silver: fresh.metals?.silver ?? stale.metals?.silver ?? null,
			},
		};
	}

	#withCacheMeta(snapshot, cached, ttlSeconds, fromCache, staleFallback, overrideError = null) {
		const fetchedAt = Number(cached?.fetchedAt || Date.now());
		return {
			...snapshot,
			cache: {
				fromCache,
				staleFallback,
				fetchedAt,
				expiresAt: Number(cached?.expiresAt || fetchedAt + ttlSeconds * 1000),
				ttlSeconds,
				lastError: overrideError || cached?.lastError || null,
			},
		};
	}
}

/** Telegram Bot API client. */
class TelegramClient {
	constructor(env) { this.env = env; }

	async api(method, payload = {}) {
		if (!this.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is missing");
		const response = await new HttpClient().fetch(
			`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`,
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
			10_000,
		);
		let data;
		try { data = await response.json(); } catch { data = null; }
		if (!response.ok || !data?.ok) {
			const description = data?.description || `HTTP ${response.status}`;
			if (method === "editMessageText" && String(description).toLowerCase().includes("message is not modified")) return null;
			const error = new Error(description);
			error.status = response.status;
			throw error;
		}
		return data.result;
	}

	sendMessage(chatId, text, replyMarkup = null) {
		return this.api("sendMessage", {
			chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
			...(replyMarkup ? { reply_markup: replyMarkup } : {}),
		});
	}

	editMessage(chatId, messageId, text, replyMarkup = null) {
		return this.api("editMessageText", {
			chat_id: chatId, message_id: Number(messageId), text,
			parse_mode: "HTML", disable_web_page_preview: true,
			...(replyMarkup ? { reply_markup: replyMarkup } : {}),
		});
	}

	sendRichMessage(chatId, richMessage, replyMarkup = null) {
		return this.api("sendRichMessage", {
			chat_id: chatId, rich_message: richMessage,
			...(replyMarkup ? { reply_markup: replyMarkup } : {}),
		});
	}

	async editRichMessage(chatId, messageId, richMessage, fallbackText, replyMarkup = null) {
		try {
			return await this.api("editMessageText", {
				chat_id: chatId,
				message_id: Number(messageId),
				rich_message: richMessage,
				...(replyMarkup ? { reply_markup: replyMarkup } : {}),
			});
		} catch (error) {
			console.warn("telegram.rich_edit_fallback", errorMessage(error));
			return this.editMessage(chatId, messageId, fallbackText, replyMarkup);
		}
	}

	async answerCallback(id, text = undefined, showAlert = false) {
		try {
			await this.api("answerCallbackQuery", {
				callback_query_id: id,
				...(text ? { text } : {}),
				show_alert: showAlert,
			});
		} catch { /* expired callback */ }
	}

	async syncInterface() {
		if (!telegramSyncPromise) {
			telegramSyncPromise = Promise.all([
				this.api("setMyCommands", { commands: [
					{ command: "start", description: "Start DRD Rate Manager" },
					{ command: "menu", description: "Open management panel" },
					{ command: "help", description: "Show help" },
					{ command: "id", description: "Show your Telegram ID" },
				] }),
				this.api("setChatMenuButton", { menu_button: { type: "commands" } }),
			]).catch((error) => {
				telegramSyncPromise = null;
				console.warn("telegram.interface_sync_failed", errorMessage(error));
			});
		}
		return telegramSyncPromise;
	}
}

/** Pure market-post renderer. No network or database access. */
class MarketPostBuilder {
	constructor(config) { this.config = config; }

	buildRichMessage(snapshot) {
		const LRI = "\u2066";
		const PDI = "\u2069";
		const ltr = (value) => `${LRI}${value}${PDI}`;
		const cryptoItem = (coin) => {
			const name = escapeHtml(coinNameFa(coin.id, coin.name));
			const price = coin.price == null ? "<b>نامشخص</b>" : formatOptionalUsd(coin.price);
			const change = coin.change24h == null
				? "⚪ تغییر ۲۴ ساعته: <b>نامشخص</b>"
				: `${changeIcon(coin.change24h)} تغییر ۲۴ ساعته: ${formatFaChangeValue(coin.change24h)}`;
			return `<p><b>${name}</b><br>${price}<br>${change}</p>`;
		};
		const [firstCoin, ...remainingCoins] = snapshot.crypto || [];
		const firstCryptoHtml = firstCoin ? cryptoItem(firstCoin) : "<p><b>نامشخص</b></p>";
		const remainingCryptoHtml = remainingCoins.map(cryptoItem).join("");
		const mazaneh = snapshot.metals?.mazaneh == null ? null : roundToNearest(snapshot.metals.mazaneh, 1000);
		const remainingMetalsHtml = [
			`<p><b>مظنه طلا</b><br>${formatOptionalToman(mazaneh)}</p>`,
			`<p><b>انس طلا</b><br>${formatOptionalUsd(snapshot.metals?.gold)}</p>`,
			`<p><b>نقره</b><br>${formatOptionalUsd(snapshot.metals?.silver)}</p>`,
		].join("");
		const footerTime = ltr(`🕒 ${formatIranTime(this.config, snapshot.createdAt)} · 📅 ${formatIranDate(this.config, snapshot.createdAt)}`);
		const handle = this.config.channelHandle;
		const footerChannel = handle ? ltr(`🚀 ${escapeHtml(handle)}`) : "";
		const html = [
			"<p><b>⚡️ نبض بازار</b></p>",
			`<p>💵 <b>تتر</b><br>${formatOptionalToman(snapshot.usdt?.price)}</p>`,
			"<p><br></p>",
			"<p><b>🪙 رمزارزها</b></p>",
			firstCryptoHtml,
			remainingCoins.length
				? `<details><summary>برای مشاهده بقیه، ضربه بزنید ↓</summary>${remainingCryptoHtml}</details>`
				: "",
			"<p><br></p>",
			"<p><b>🥇 طلا و فلزات</b></p>",
			`<p><b>طلای ۱۸ عیار</b><br>${formatOptionalToman(snapshot.metals?.gram18)}</p>`,
			`<details><summary>برای مشاهده بقیه، ضربه بزنید ↓</summary>${remainingMetalsHtml}</details>`,
			"<p><br></p>",
			"<hr/>",
			`<p>${footerTime}</p>`,
			handle ? `<blockquote>${footerChannel}</blockquote>` : "",
		].join("");
		return { html, is_rtl: true, skip_entity_detection: false };
	}

	buildFallbackHtml(snapshot) {
		const lines = [
			"⚡️ <b>نبض بازار</b>", "", "💵 <b>تتر</b>", formatOptionalToman(snapshot.usdt?.price), "", "",
			"🪙 <b>رمزارزها</b>", "",
		];
		for (const coin of snapshot.crypto || []) {
			lines.push(`<b>${escapeHtml(coinNameFa(coin.id, coin.name))}</b>`, formatOptionalUsd(coin.price),
				coin.change24h == null ? "⚪ تغییر ۲۴ ساعته: <b>نامشخص</b>" : `${changeIcon(coin.change24h)} تغییر ۲۴ ساعته: ${formatFaChangeValue(coin.change24h)}`, "");
		}
		lines.push("", "🥇 <b>طلا و فلزات</b>", "",
			"<b>طلای ۱۸ عیار</b>", formatOptionalToman(snapshot.metals?.gram18), "",
			"<b>مظنه طلا</b>", formatOptionalToman(roundToNearest(snapshot.metals?.mazaneh, 1000)), "",
			"<b>انس طلا</b>", formatOptionalUsd(snapshot.metals?.gold), "",
			"<b>نقره</b>", formatOptionalUsd(snapshot.metals?.silver), "", "", "━━━━━━━━━━━━", "",
			`🕒 <b>${escapeHtml(formatIranTime(this.config, snapshot.createdAt))}</b> · 📅 <b>${escapeHtml(formatIranDate(this.config, snapshot.createdAt))}</b>`);
		if (this.config.channelHandle) lines.push("", `<blockquote>🚀 ${escapeHtml(this.config.channelHandle)}</blockquote>`);
		return lines.join("\n");
	}
}

/** Channel publisher with explicit rendering dependency. */
class MarketPublisher {
	constructor(config, telegram, builder) { this.config = config; this.telegram = telegram; this.builder = builder; }

	async publish(snapshot) {
		if (!this.config.channelId) throw new Error("TELEGRAM_CHANNEL_ID is missing");
		return this.telegram.sendRichMessage(this.config.channelId, this.builder.buildRichMessage(snapshot));
	}
}

/** Automatic publishing settings and scheduled execution. */
class AutomationService {
	constructor(env, config, settings, market, publisher) {
		Object.assign(this, { env, config, settings, market, publisher });
	}

	async getSettings() {
		const keys = [
			"auto_publish_enabled", "publish_interval_minutes", "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end",
			"auto_publish_last_run_at", "auto_publish_last_success_at", "auto_publish_last_error", "auto_publish_last_tick_at",
			"auto_publish_last_attempt_at", "auto_publish_last_error_at", "auto_publish_last_skip_reason",
		];
		const map = await this.settings.getMany(keys);
		return {
			enabled: parseBoolean(map.auto_publish_enabled, false),
			intervalMinutes: normalizePublishInterval(map.publish_interval_minutes),
			quietHours: {
				enabled: parseBoolean(map.quiet_hours_enabled, false),
				start: validTime(map.quiet_hours_start) ? map.quiet_hours_start : APP.defaultQuietHours.start,
				end: validTime(map.quiet_hours_end) ? map.quiet_hours_end : APP.defaultQuietHours.end,
			},
			lastRunAt: normalizeTimestamp(map.auto_publish_last_run_at),
			lastSuccessAt: normalizeTimestamp(map.auto_publish_last_success_at),
			lastError: map.auto_publish_last_error || "",
			lastTickAt: normalizeTimestamp(map.auto_publish_last_tick_at),
			lastAttemptAt: normalizeTimestamp(map.auto_publish_last_attempt_at),
			lastErrorAt: normalizeTimestamp(map.auto_publish_last_error_at),
			lastSkipReason: map.auto_publish_last_skip_reason || "",
		};
	}

	async tick() {
		const now = Date.now();
		const map = await this.settings.getMany([
			"bot_enabled", "auto_publish_enabled", "publish_interval_minutes", "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end", "auto_publish_last_run_at", "auto_publish_last_tick_at",
		]);
		const heartbeatDue = now - normalizeTimestamp(map.auto_publish_last_tick_at) >= 5 * 60 * 1000;
		if (heartbeatDue) await this.settings.set("auto_publish_last_tick_at", now);
		if (!parseBoolean(map.bot_enabled, true)) return this.#skip("bot_disabled");
		if (!parseBoolean(map.auto_publish_enabled, false)) return this.#skip("automation_disabled");
		const interval = normalizePublishInterval(map.publish_interval_minutes);
		const quiet = {
			enabled: parseBoolean(map.quiet_hours_enabled, false),
			start: validTime(map.quiet_hours_start) ? map.quiet_hours_start : APP.defaultQuietHours.start,
			end: validTime(map.quiet_hours_end) ? map.quiet_hours_end : APP.defaultQuietHours.end,
		};
		if (quiet.enabled && isInsideQuietHours(this.config, quiet, now)) return this.#skip("quiet_hours");
		const lastRun = normalizeTimestamp(map.auto_publish_last_run_at);
		if (lastRun && now - lastRun < interval * 60 * 1000) return this.#skip("interval_not_due");

		const claimed = await this.#claim(lastRun, now);
		if (!claimed) return this.#skip("already_claimed");
		await this.settings.setMany({ auto_publish_last_attempt_at: now, auto_publish_last_skip_reason: "" });
		try {
			const snapshot = await this.market.getSnapshot();
			await this.publisher.publish(snapshot);
			await this.settings.setMany({
				auto_publish_last_success_at: now,
				auto_publish_last_error: "",
				auto_publish_last_error_at: 0,
				auto_publish_last_skip_reason: "success",
			});
		} catch (error) {
			await this.settings.setMany({
				auto_publish_last_error: errorMessage(error).slice(0, 1000),
				auto_publish_last_error_at: now,
				auto_publish_last_skip_reason: "error",
			});
			throw error;
		}
	}

	async #claim(expectedLastRun, now) {
		const result = await this.env.DB.prepare(`UPDATE settings SET value = ?, updated_at = ?
			WHERE key = 'auto_publish_last_run_at' AND value = ?`)
			.bind(String(now), now, String(expectedLastRun || 0)).run();
		if (Number(result?.meta?.changes || 0) > 0) return true;
		if (!expectedLastRun) {
			const insert = await this.env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value, created_at, updated_at)
				VALUES ('auto_publish_last_run_at', ?, ?, ?)`)
				.bind(String(now), now, now).run();
			return Number(insert?.meta?.changes || 0) > 0;
		}
		return false;
	}

	async #skip(reason) {
		if (["bot_disabled", "automation_disabled", "quiet_hours"].includes(reason)) {
			await this.settings.set("auto_publish_last_skip_reason", reason);
		}
	}
}

/** HTTP API controller. */
class ApiController {
	constructor(services) { this.s = services; }

	async route(request, url) {
		if (request.method === "OPTIONS") return corsResponse();
		if (request.method !== "GET") return null;
		switch (url.pathname) {
			case "/": return jsonResponse({
				success: true,
				service: this.s.config.env.APP_NAME || APP.name,
				version: this.s.config.version,
				api_version: APP.apiVersion,
				endpoints: {
					market: "/api/v1/market", assets: "/api/v1/assets", sources: "/api/v1/sources",
					usdt: "/api/v1/sources/usdt", automation: "/api/v1/automation",
					system: "/api/v1/system", database: "/api/v1/system/database",
				},
			});
			case "/api/v1/market": {
				const snapshot = await this.s.market.getSnapshot();
				return jsonResponse({ success: true, data: serializeMarketSnapshot(this.s.config, snapshot) });
			}
			case "/api/v1/assets": {
				const assets = await this.s.assets.all();
				return jsonResponse({ success: true, data: {
					cached: true, count: assets.length, enabled_count: assets.filter((item) => item.enabled).length, assets,
				} });
			}
			case "/api/v1/sources": {
				const sources = await this.s.statuses.all();
				return jsonResponse({ success: true, data: { cached: true, sources, usdt: resolveUsdtFromStatuses(sources) } });
			}
			case "/api/v1/sources/usdt": {
				const sources = await this.s.statuses.all();
				return jsonResponse({ success: true, data: resolveUsdtFromStatuses(sources) });
			}
			case "/api/v1/automation": {
				const a = await this.s.automation.getSettings();
				return jsonResponse({ success: true, data: serializeAutomation(this.s.config, a) });
			}
			case "/api/v1/system": {
				const [enabled, adminStats, automation] = await Promise.all([
					this.s.settings.get("bot_enabled", "1"), this.s.admins.stats(), this.s.automation.getSettings(),
				]);
				return jsonResponse({ success: true, data: {
					service: APP.name, version: this.s.config.version, api_version: APP.apiVersion,
					timezone: this.s.config.timezone, enabled: parseBoolean(enabled, true),
					integrity: runtimeIntegrity(), admins: adminStats,
					automation: { enabled: automation.enabled, interval_minutes: automation.intervalMinutes, quiet_hours_enabled: automation.quietHours.enabled },
				} });
			}
			case "/api/v1/system/database": return jsonResponse({ success: true, data: await databaseStatus(this.s) });
			default: return null;
		}
	}
}

/** Telegram administration controller. */
class BotController {
	constructor(services) { this.s = services; }

	async handleWebhook(request) {
		if (!this.#verifyWebhook(request)) return jsonResponse({ success: false, message: "Unauthorized" }, 401);
		const update = await request.json();
		try {
			await this.#process(update);
		} catch (error) {
			console.error("telegram.update_failed", { message: errorMessage(error), stack: error?.stack || null });
		}
		return jsonResponse({ success: true });
	}

	#verifyWebhook(request) {
		const expected = String(this.s.env.TELEGRAM_WEBHOOK_SECRET || "");
		if (!expected) return true;
		return request.headers.get("X-Telegram-Bot-Api-Secret-Token") === expected;
	}

	async #process(update) {
		if (update.callback_query) return this.#callback(update.callback_query);
		if (update.message) return this.#message(update.message);
	}

	async #message(message) {
		const user = message.from;
		const command = normalizeCommand(message.text || "");
		if (["/start", "/menu", "/help"].includes(command)) this.s.telegram.syncInterface();
		if (command === "/id") return this.s.telegram.sendMessage(message.chat.id, `<b>🆔 شناسه شما</b>\n\n<code>${escapeHtml(String(user?.id || ""))}</code>`);

		const admin = await this.s.admins.resolve(user);
		if (!admin) return this.s.telegram.sendMessage(message.chat.id, "<b>⛔️ دسترسی غیرمجاز</b>\n\nشما اجازه استفاده از این ربات را ندارید.");
		await this.s.admins.touchProfile(user);

		const input = await this.s.adminInput.get(user.id);
		if (input?.action === "add_admin" && !command) return this.#handleAddAdminInput(message, admin);

		const enabled = parseBoolean(await this.s.settings.get("bot_enabled", "1"), true);
		if (!enabled && admin.role !== "owner") return this.s.telegram.sendMessage(message.chat.id, this.#disabledText(admin));

		switch (command) {
			case "/start": return this.#sendStart(message.chat.id, admin);
			case "/menu": return this.#sendMenu(message.chat.id, admin);
			case "/help": return this.#sendHelp(message.chat.id, admin);
			default: return this.#sendMenu(message.chat.id, admin);
		}
	}

	async #callback(query) {
		await this.s.telegram.answerCallback(query.id);
		const user = query.from;
		const message = query.message;
		const admin = await this.s.admins.resolve(user);
		if (!admin) return this.s.telegram.editMessage(message.chat.id, message.message_id, "<b>⛔️ دسترسی غیرمجاز</b>");
		const data = String(query.data || "");
		const enabled = parseBoolean(await this.s.settings.get("bot_enabled", "1"), true);
		if (!enabled && admin.role !== "owner" && data !== "global:enable") {
			return this.s.telegram.editMessage(message.chat.id, message.message_id, this.#disabledText(admin));
		}

		if (data === "menu:home") return this.#showMenu(message, admin);
		if (data === "help:home") return this.#showHelp(message, admin);
		if (data === "market:home") return this.#showMarket(message);
		if (data === "market:refresh") return this.#showMarket(message, true);
		if (data === "market:preview") return this.#showPreview(message);
		if (data === "market:publish") return this.#publish(message, user);
		if (data === "sources:home") return this.#showSources(message);
		if (data === "sources:refresh") return this.#showSources(message, true);
		if (data === "sources:usdt") return this.#showUsdt(message);
		if (data === "coingecko:home") return this.#showCoinGecko(message);
		if (data === "coingecko:refresh") return this.#showCoinGecko(message, true);
		if (data.startsWith("coingecko:toggle:")) {
			await this.s.assets.toggle(data.slice("coingecko:toggle:".length));
			return this.#showCoinGecko(message);
		}
		if (data === "settings:home") return this.#showSettings(message, admin);
		if (data === "cache:home") return this.#showCacheSettings(message);
		if (data.startsWith("cache:set:")) {
			const seconds = Number(data.slice("cache:set:".length));
			if (APP.cacheTtlOptions.includes(seconds)) await this.s.settings.set("market_cache_ttl_seconds", seconds);
			return this.#showCacheSettings(message);
		}
		if (data === "automation:home") return this.#showAutomation(message);
		if (data === "automation:toggle") {
			const a = await this.s.automation.getSettings();
			await this.s.settings.set("auto_publish_enabled", a.enabled ? "0" : "1");
			return this.#showAutomation(message);
		}
		if (data === "automation:interval") return this.#showIntervals(message);
		if (data.startsWith("automation:interval:set:")) {
			const minutes = Number(data.slice("automation:interval:set:".length));
			if (APP.publishIntervals.includes(minutes)) await this.s.settings.set("publish_interval_minutes", minutes);
			return this.#showAutomation(message);
		}
		if (data === "automation:quiet:toggle") {
			const a = await this.s.automation.getSettings();
			await this.s.settings.set("quiet_hours_enabled", a.quietHours.enabled ? "0" : "1");
			return this.#showAutomation(message);
		}
		if (data === "automation:quiet:edit") return this.#quietStartHour(message);
		if (data.startsWith("quiet:start_hour:")) return this.#quietStartMinute(message, Number(data.split(":")[2]));
		if (data.startsWith("quiet:start_minute:")) {
			const [, , hour, minute] = data.split(":");
			return this.#quietEndHour(message, Number(hour), Number(minute));
		}
		if (data.startsWith("quiet:end_hour:")) {
			const [, , startHour, startMinute, endHour] = data.split(":");
			return this.#quietEndMinute(message, Number(startHour), Number(startMinute), Number(endHour));
		}
		if (data.startsWith("quiet:end_minute:")) {
			const [, , sh, sm, eh, em] = data.split(":");
			await this.s.settings.setMany({
				quiet_hours_start: `${pad2(sh)}:${pad2(sm)}`,
				quiet_hours_end: `${pad2(eh)}:${pad2(em)}`,
				quiet_hours_enabled: "1",
			});
			return this.#showAutomation(message);
		}
		if (data === "system:home") return this.#showSystem(message);
		if (data === "database:home") return this.#showDatabase(message);
		if (data === "admins:home") return this.#showAdmins(message, admin);
		if (data === "admins:add" && admin.role === "owner") {
			await this.s.adminInput.set(user.id, "add_admin");
			return this.s.telegram.editMessage(message.chat.id, message.message_id,
				"<b>➕ افزودن ادمین</b>\n\nآیدی عددی Telegram کاربر را ارسال کنید.\n\n<blockquote>ℹ️ فقط مالک می‌تواند ادمین اضافه یا حذف کند.</blockquote>",
				backKeyboard("مدیریت ادمین‌ها", "admins:home"));
		}
		if (data.startsWith("admins:view:")) return this.#showAdminDetail(message, admin, data.slice("admins:view:".length));
		if (data.startsWith("admins:toggle:") && admin.role === "owner") {
			await this.s.admins.toggle(data.slice("admins:toggle:".length));
			return this.#showAdminDetail(message, admin, data.slice("admins:toggle:".length));
		}
		if (data.startsWith("admins:delete:") && admin.role === "owner") {
			await this.s.admins.remove(data.slice("admins:delete:".length));
			return this.#showAdmins(message, admin);
		}
		if (data === "global:disable" && admin.role === "owner") {
			await this.s.settings.set("bot_enabled", "0");
			return this.s.telegram.editMessage(message.chat.id, message.message_id, this.#disabledText(admin), { inline_keyboard: [[{ text: "▶️ فعال کردن ربات", callback_data: "global:enable" }]] });
		}
		if (data === "global:enable" && admin.role === "owner") {
			await this.s.settings.set("bot_enabled", "1");
			return this.#showMenu(message, admin);
		}
	}

	async #sendStart(chatId, admin) {
		return this.s.telegram.sendMessage(chatId, [
			`<b>⚡️ ${escapeHtml(this.s.config.displayName)}</b>`, "",
			`نقش شما: <b>${admin.role === "owner" ? "مالک" : "ادمین"}</b>`, "",
			"مدیریت بازار، منابع، انتشار خودکار و وضعیت سیستم از همین ربات انجام می‌شود.",
		].join("\n"), { inline_keyboard: [[{ text: "📋 پنل مدیریت", callback_data: "menu:home" }]] });
	}

	async #sendMenu(chatId, admin) {
		return this.s.telegram.sendMessage(chatId, this.#menuText(admin), this.#menuKeyboard());
	}

	async #showMenu(message, admin) {
		return this.s.telegram.editMessage(message.chat.id, message.message_id, this.#menuText(admin), this.#menuKeyboard());
	}

	#menuText(admin) {
		const now = Date.now();
		return [
			`<b>⚡️ ${escapeHtml(this.s.config.displayName)}</b>`, "",
			`نقش: <b>${admin.role === "owner" ? "مالک" : "ادمین"}</b>`,
			`📅 ${formatIranDate(this.s.config, now)}  ·  🕒 ${formatIranTime(this.s.config, now)}`,
			`Timezone: <code>${escapeHtml(this.s.config.timezone)}</code>`, "",
			"<blockquote>ℹ️ از دکمه‌های زیر برای مدیریت بازار و سیستم استفاده کنید.</blockquote>", "",
			`Version: <code>${escapeHtml(this.s.config.version)}</code>`,
		].join("\n");
	}

	#menuKeyboard() {
		return { inline_keyboard: [
			[{ text: "📈 مدیریت بازار", callback_data: "market:home" }],
			[{ text: "📡 مدیریت منابع", callback_data: "sources:home" }, { text: "👥 مدیریت ادمین‌ها", callback_data: "admins:home" }],
			[{ text: "⚙️ تنظیمات", callback_data: "settings:home" }, { text: "❓ راهنما", callback_data: "help:home" }],
		] };
	}

	async #sendHelp(chatId, admin) { return this.s.telegram.sendMessage(chatId, this.#helpText(admin)); }
	async #showHelp(message, admin) { return this.s.telegram.editMessage(message.chat.id, message.message_id, this.#helpText(admin), backKeyboard("پنل مدیریت", "menu:home")); }
	#helpText(admin) {
		return [
			"<b>❓ راهنمای DRD RATE MANAGER</b>", "",
			"<b>دستورات</b>", "<code>/start</code> شروع", "<code>/menu</code> پنل مدیریت", "<code>/help</code> راهنما", "<code>/id</code> شناسه تلگرام", "",
			"<b>📈 مدیریت بازار</b>", "نمایش داده کش‌شده، پیش‌نمایش، انتشار دستی و بروزرسانی اجباری.", "",
			"<b>📡 منابع</b>", "USDT: Wallex → Tabdeal → Exir", "Crypto + Global Metals: CoinGecko", "Iran Gold: WallGold", "",
			"<b>🗃 کش بازار</b>", "تمام Bot/API/Cron از یک Snapshot مرکزی D1 استفاده می‌کنند. مدت اعتبار از تنظیمات قابل تغییر است.", "",
			"<b>🤖 انتشار خودکار</b>", "Cron هر دقیقه وضعیت را بررسی می‌کند؛ انتشار فقط در موعد و خارج Quiet Hours انجام می‌شود.", "",
			`Role: <code>${admin.role}</code>`, `Timezone: <code>${escapeHtml(this.s.config.timezone)}</code>`, `Version: <code>${escapeHtml(this.s.config.version)}</code>`,
		].join("\n");
	}

	async #showMarket(message, force = false) {
		await this.s.telegram.editMessage(message.chat.id, message.message_id, "<b>📈 مدیریت بازار</b>\n\n⏳ در حال خواندن کش بازار...", backKeyboard("پنل مدیریت", "menu:home"));
		const [snapshot, automation] = await Promise.all([
			this.s.market.getSnapshot({ forceRefresh: force }), this.s.automation.getSettings(),
		]);
		const lines = [
			"<b>📈 مدیریت بازار</b>", "",
			snapshot.partial ? "<blockquote>🟡 بخشی از اطلاعات از آخرین کش سالم تکمیل شده است</blockquote>" : "<blockquote>🟢 همه‌چیز آماده انتشار است</blockquote>", "",
			`🗃 کش: <b>${snapshot.cache.fromCache ? "استفاده شد" : "بروزرسانی شد"}</b> · ${snapshot.cache.ttlSeconds} ثانیه`,
			`🕒 داده: <b>${formatIranTime(this.s.config, snapshot.createdAt)}</b>`, "",
			"💵 <b>تتر</b>", formatOptionalToman(snapshot.usdt.price), "", "",
			`🪙 <b>رمزارزها</b> · <b>${snapshot.crypto.length} فعال</b>`, "",
		];
		for (const coin of snapshot.crypto) lines.push(`${escapeHtml(coinNameFa(coin.id, coin.name))} · ${formatOptionalUsd(coin.price)}`, coin.change24h == null ? "⚪ 24 ساعته: <b>نامشخص</b>" : `${changeIcon(coin.change24h)} 24 ساعته: ${formatFaChangeValue(coin.change24h)}`, "");
		lines.push("", "🥇 <b>طلا و فلزات</b>", "",
			`طلای ۱۸ عیار · ${formatOptionalToman(snapshot.metals.gram18)}`,
			`مظنه طلا · ${formatOptionalToman(roundToNearest(snapshot.metals.mazaneh, 1000))}`,
			`انس طلا · ${formatOptionalUsd(snapshot.metals.gold)}`,
			`نقره · ${formatOptionalUsd(snapshot.metals.silver)}`, "", "━━━━━━━━━━━━", "",
			`🤖 انتشار خودکار: ${automation.enabled ? "🟢 فعال" : "⚪ غیرفعال"}`,
			`⏱ بازه: <b>${automation.intervalMinutes} دقیقه</b>`);
		return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), { inline_keyboard: [
			[{ text: "🚀 انتشار اکنون", callback_data: "market:publish" }, { text: "📄 پیش‌نمایش", callback_data: "market:preview" }],
			[{ text: "🤖 زمان‌بندی انتشار", callback_data: "automation:home" }],
			[{ text: "🔄 بروزرسانی", callback_data: "market:refresh" }],
			[{ text: "⬅️ پنل مدیریت", callback_data: "menu:home" }],
		] });
	}

	async #showPreview(message) {
		const snapshot = await this.s.market.getSnapshot();
		const rich = this.s.postBuilder.buildRichMessage(snapshot);
		return this.s.telegram.editRichMessage(message.chat.id, message.message_id, rich,
			this.s.postBuilder.buildFallbackHtml(snapshot), { inline_keyboard: [
				[{ text: "🚀 انتشار اکنون", callback_data: "market:publish" }],
				[{ text: "🔄 پیش‌نمایش جدید", callback_data: "market:preview" }],
				[{ text: "⬅️ مدیریت بازار", callback_data: "market:home" }],
			] });
	}

	async #publish(message, user) {
		await this.s.telegram.editMessage(message.chat.id, message.message_id, "<b>🚀 انتشار بازار</b>\n\n⏳ در حال آماده‌سازی داده کش‌شده...", backKeyboard("مدیریت بازار", "market:home"));
		try {
			const snapshot = await this.s.market.getSnapshot();
			const result = await this.s.publisher.publish(snapshot);
			await this.s.audit.add(user.id, "market.manual_published", { messageId: result?.message_id ?? null, partial: snapshot.partial });
			return this.s.telegram.editMessage(message.chat.id, message.message_id,
				"<b>🚀 انتشار بازار</b>\n\n<blockquote>✅ پست با موفقیت منتشر شد</blockquote>\n\n" + (snapshot.partial ? "🟡 بعضی داده‌ها از آخرین کش سالم تکمیل شدند." : "🟢 تمام اطلاعات بازار آماده بود."),
				backKeyboard("مدیریت بازار", "market:home"));
		} catch (error) {
			return this.s.telegram.editMessage(message.chat.id, message.message_id,
				`<b>🚀 انتشار بازار</b>\n\n🔴 ارسال پیام به کانال ناموفق بود.\n\n<code>${escapeHtml(errorMessage(error))}</code>`,
				backKeyboard("مدیریت بازار", "market:home"));
		}
	}

	async #showSources(message, force = false) {
		if (force) await this.s.market.forceRefreshSources();
		const sources = await this.s.statuses.all();
		const lines = ["<b>📡 مدیریت منابع</b>", "", "<b>💵 تتر / تومان</b>", "",
			sourceStatusText("Wallex", sources.wallex, "Primary"), "",
			sourceStatusText("Tabdeal", sources.tabdeal, "Fallback #1"), "",
			sourceStatusText("Exir", sources.exir, "Fallback #2"), "",
			"<b>🪙 رمزارزها و فلزات جهانی</b>", "", sourceStatusText("CoinGecko", sources.coingecko), "",
			"<b>🥇 طلای ایران</b>", "", sourceStatusText("WallGold", sources.wallgold), "",
			"<blockquote>ℹ️ این صفحه فقط از وضعیت کش‌شده D1 می‌خواند. «بررسی مجدد» منابع را بروزرسانی می‌کند.</blockquote>"];
		return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), { inline_keyboard: [
			[{ text: "🪙 مدیریت CoinGecko", callback_data: "coingecko:home" }],
			[{ text: "💵 مسیر دریافت تتر", callback_data: "sources:usdt" }],
			[{ text: "🔄 بررسی مجدد", callback_data: "sources:refresh" }],
			[{ text: "⬅️ پنل مدیریت", callback_data: "menu:home" }],
		] });
	}

	async #showUsdt(message) {
		const sources = await this.s.statuses.all();
		const result = resolveUsdtFromStatuses(sources);
		const text = result.available
			? `<b>💵 مسیر دریافت تتر</b>\n\n<blockquote>✅ قیمت معتبر کش‌شده</blockquote>\n\n💰 <b>${formatFaInteger(result.price_toman)} تومان</b>\n\n📡 <b>${escapeHtml(result.selected_source)}</b>\n\nWallex → Tabdeal → Exir`
			: "<b>💵 مسیر دریافت تتر</b>\n\n<blockquote>🟡 قیمت تتر در کش موجود نیست</blockquote>\n\nWallex → Tabdeal → Exir";
		return this.s.telegram.editMessage(message.chat.id, message.message_id, text, { inline_keyboard: [
			[{ text: "🔄 بروزرسانی منابع", callback_data: "sources:refresh" }],
			[{ text: "⬅️ مدیریت منابع", callback_data: "sources:home" }],
		] });
	}

	async #showCoinGecko(message, force = false) {
		let refreshError = null;
		if (force) {
			const result = await this.s.coinGecko.fetchTopAssets();
			if (result.success) await this.s.assets.syncTopAssets(result.assets);
			else refreshError = result.message;
		}
		const assets = await this.s.assets.all();
		const lines = ["<b>🪙 مدیریت CoinGecko</b>", "", `<blockquote>${refreshError ? `🔴 ${escapeHtml(refreshError)}` : `🟢 ${assets.length} دارایی کش‌شده`}</blockquote>`, "",
			"با انتخاب هر مورد، نمایش آن در پست‌های بازار فعال/غیرفعال می‌شود."];
		const keyboard = assets.slice(0, this.s.config.coinGeckoTopLimit).map((asset) => [{
			text: `${asset.enabled ? "✅" : "▫️"} ${asset.symbol} · ${asset.name_fa}`,
			callback_data: `coingecko:toggle:${asset.id}`,
		}]);
		keyboard.push([{ text: "🔄 بروزرسانی لیست", callback_data: "coingecko:refresh" }]);
		keyboard.push([{ text: "⬅️ مدیریت منابع", callback_data: "sources:home" }]);
		return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), { inline_keyboard: keyboard });
	}

	async #showSettings(message, admin) {
		const ttl = await this.s.market.cacheTtlSeconds();
		const enabled = parseBoolean(await this.s.settings.get("bot_enabled", "1"), true);
		const keyboard = [
			[{ text: "🕒 زمان‌بندی انتشار", callback_data: "automation:home" }],
			[{ text: "📊 وضعیت سیستم", callback_data: "system:home" }],
			[{ text: `🗃 کش بازار · ${ttl} ثانیه`, callback_data: "cache:home" }],
		];
		if (admin.role === "owner") keyboard.push([{ text: enabled ? "⏸ غیرفعال کردن ربات" : "▶️ فعال کردن ربات", callback_data: enabled ? "global:disable" : "global:enable" }]);
		keyboard.push([{ text: "⬅️ پنل مدیریت", callback_data: "menu:home" }]);
		return this.s.telegram.editMessage(message.chat.id, message.message_id,
			`<b>⚙️ تنظیمات</b>\n\n<blockquote>${enabled ? "🟢 سیستم فعال است" : "🔴 سیستم غیرفعال است"}</blockquote>\n\n<blockquote>ℹ️ زمان‌بندی انتشار، وضعیت سیستم و مدت اعتبار کش بازار از این بخش مدیریت می‌شوند. کش فعلی: ${ttl} ثانیه.</blockquote>`,
			{ inline_keyboard: keyboard });
	}

	async #showCacheSettings(message) {
		const current = await this.s.market.cacheTtlSeconds();
		const keyboard = chunk(APP.cacheTtlOptions.map((seconds) => ({
			text: `${seconds === current ? "✅" : "▫️"} ${seconds} ثانیه`, callback_data: `cache:set:${seconds}`,
		})), 2);
		keyboard.push([{ text: "⬅️ تنظیمات", callback_data: "settings:home" }]);
		return this.s.telegram.editMessage(message.chat.id, message.message_id,
			`<b>🗃 کش بازار</b>\n\nمدت اعتبار فعلی: <b>${current} ثانیه</b>\n\n<blockquote>ℹ️ Bot، API و Cron همگی از همین Snapshot مرکزی استفاده می‌کنند.</blockquote>`,
			{ inline_keyboard: keyboard });
	}

	async #showAutomation(message) {
		const a = await this.s.automation.getSettings();
		const next = calculateNextPublishAt(a);
		const lines = ["<b>🕒 زمان‌بندی انتشار</b>", "", `<blockquote>${a.enabled ? "🟢 انتشار خودکار فعال است" : "⚪ انتشار خودکار غیرفعال است"}</blockquote>`, "",
			`⏱ بازه انتشار: <b>${a.intervalMinutes} دقیقه</b>`, "",
			`🌙 ساعت استراحت: <b>${a.quietHours.enabled ? `${a.quietHours.start} تا ${a.quietHours.end}` : "غیرفعال"}</b>`, "",
			`📤 آخرین انتشار: <b>${formatOptionalSystemDateTime(this.s.config, a.lastSuccessAt)}</b>`,
			`🫀 آخرین Cron Tick: <b>${formatOptionalSystemDateTime(this.s.config, a.lastTickAt)}</b>`,
			`🎯 آخرین تلاش: <b>${formatOptionalSystemDateTime(this.s.config, a.lastAttemptAt)}</b>`,
			`⚠️ آخرین خطا: ${a.lastError ? `<code>${escapeHtml(a.lastError)}</code>` : "ندارد"}`,
			`ℹ️ وضعیت آخر: <code>${escapeHtml(a.lastSkipReason || "-")}</code>`, "",
			`⏭ انتشار بعدی: <b>${formatOptionalSystemDateTime(this.s.config, next)}</b>`, "",
			"<blockquote>ℹ️ Worker هر دقیقه بررسی می‌شود و فقط وقتی بازه انتشار رسیده باشد و داخل ساعت استراحت نباشیم، پست ارسال می‌شود.</blockquote>"];
		return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), { inline_keyboard: [
			[{ text: a.enabled ? "⏸ توقف انتشار خودکار" : "▶️ فعال‌سازی انتشار خودکار", callback_data: "automation:toggle" }],
			[{ text: "🌙 ساعت استراحت", callback_data: "automation:quiet:edit" }, { text: "⏱ بازه انتشار", callback_data: "automation:interval" }],
			[{ text: a.quietHours.enabled ? "🌙 غیرفعال کردن استراحت" : "🌙 فعال کردن استراحت", callback_data: "automation:quiet:toggle" }],
			[{ text: "🔄 بروزرسانی", callback_data: "automation:home" }],
			[{ text: "⬅️ تنظیمات", callback_data: "settings:home" }],
		] });
	}

	async #showIntervals(message) {
		const a = await this.s.automation.getSettings();
		const buttons = APP.publishIntervals.map((minutes) => ({ text: `${minutes === a.intervalMinutes ? "✅" : "▫️"} ${minutes} دقیقه`, callback_data: `automation:interval:set:${minutes}` }));
		const keyboard = chunk(buttons, 3); keyboard.push([{ text: "⬅️ زمان‌بندی انتشار", callback_data: "automation:home" }]);
		return this.s.telegram.editMessage(message.chat.id, message.message_id, "<b>⏱ بازه انتشار</b>\n\nبازه موردنظر را انتخاب کنید.", { inline_keyboard: keyboard });
	}

	#quietStartHour(message) { return this.#hourPicker(message, "<b>🌙 ساعت شروع استراحت</b>", (hour) => `quiet:start_hour:${hour}`, "automation:home"); }
	#quietStartMinute(message, hour) { return this.#minutePicker(message, "<b>🌙 دقیقه شروع</b>", (minute) => `quiet:start_minute:${hour}:${minute}`, "automation:home"); }
	#quietEndHour(message, startHour, startMinute) { return this.#hourPicker(message, "<b>🌙 ساعت پایان استراحت</b>", (hour) => `quiet:end_hour:${startHour}:${startMinute}:${hour}`, "automation:home"); }
	#quietEndMinute(message, startHour, startMinute, endHour) { return this.#minutePicker(message, "<b>🌙 دقیقه پایان</b>", (minute) => `quiet:end_minute:${startHour}:${startMinute}:${endHour}:${minute}`, "automation:home"); }

	#hourPicker(message, title, callback, back) {
		const buttons = Array.from({ length: 24 }, (_, hour) => ({ text: pad2(hour), callback_data: callback(hour) }));
		const keyboard = chunk(buttons, 4); keyboard.push([{ text: "⬅️ بازگشت", callback_data: back }]);
		return this.s.telegram.editMessage(message.chat.id, message.message_id, `${title}\n\nساعت را انتخاب کنید.`, { inline_keyboard: keyboard });
	}
	#minutePicker(message, title, callback, back) {
		const keyboard = [APP.quietMinuteOptions.map((minute) => ({ text: pad2(minute), callback_data: callback(minute) })), [{ text: "⬅️ بازگشت", callback_data: back }]];
		return this.s.telegram.editMessage(message.chat.id, message.message_id, `${title}\n\nدقیقه را انتخاب کنید.`, { inline_keyboard: keyboard });
	}

	async #showSystem(message) {
		const [enabled, ttl, automation] = await Promise.all([
			this.s.settings.get("bot_enabled", "1"), this.s.market.cacheTtlSeconds(), this.s.automation.getSettings(),
		]);
		return this.s.telegram.editMessage(message.chat.id, message.message_id, [
			"<b>📊 وضعیت سیستم</b>", "", `<blockquote>${parseBoolean(enabled, true) ? "🟢 Worker فعال است" : "🔴 Worker غیرفعال است"}</blockquote>`, "",
			`Version: <code>${escapeHtml(this.s.config.version)}</code>`, `Schema: <code>${APP.schemaVersion}</code>`, `Timezone: <code>${escapeHtml(this.s.config.timezone)}</code>`,
			`Cache: <code>${ttl}s</code>`, `Automation: <code>${automation.enabled ? "ON" : "OFF"}</code>`, `Integrity: <code>${runtimeIntegrity() ? "OK" : "FAILED"}</code>`, "",
			`📅 ${formatSystemDate(this.s.config, Date.now())} · 🕒 ${formatSystemTime(this.s.config, Date.now())}`,
		].join("\n"), { inline_keyboard: [[{ text: "🗄 وضعیت دیتابیس", callback_data: "database:home" }], [{ text: "⬅️ تنظیمات", callback_data: "settings:home" }]] });
	}

	async #showDatabase(message) {
		const status = await databaseStatus(this.s);
		const storage = status.storage;
		const lines = ["<b>🗄 وضعیت دیتابیس</b>", "", `<blockquote>${status.connected ? "🟢 Cloudflare D1 متصل است" : "🔴 اتصال D1 ناموفق است"}</blockquote>`, "",
			`Provider: <code>${escapeHtml(status.provider)}</code>`, `Latency: <code>${status.latency_ms}ms</code>`, "", "<b>💾 فضای دیتابیس</b>", ""];
		if (storage.available) lines.push(`${storage.bar}  ${storage.percent.toFixed(2)}%`, "", `استفاده: ${storage.percent.toFixed(2)}%`, `مصرف‌شده: ${storage.used_mb.toFixed(2)} MB`, `فضای کل: ${storage.total_mb.toFixed(2)} MB`, `باقی‌مانده: ${storage.remaining_mb.toFixed(2)} MB`, "");
		lines.push("<b>📊 رکوردها</b>", ...Object.entries(status.records).map(([key, value]) => `${escapeHtml(key)}: <code>${value}</code>`), "", `Schema: <code>${APP.schemaVersion}</code>`);
		return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), backKeyboard("وضعیت سیستم", "system:home"));
	}

	async #showAdmins(message, admin) {
		const admins = await this.s.admins.list();
		const lines = ["<b>👥 مدیریت ادمین‌ها</b>", "", `مالک: <code>${escapeHtml(this.s.config.ownerId || "تنظیم نشده")}</code>`, "", `ادمین‌ها: <b>${admins.length}</b>`];
		const keyboard = admins.map((row) => [{ text: `${Number(row.is_active) === 1 ? "🟢" : "⚪"} ${row.first_name || row.username || row.user_id}`, callback_data: `admins:view:${row.user_id}` }]);
		if (admin.role === "owner") keyboard.push([{ text: "➕ افزودن ادمین", callback_data: "admins:add" }]);
		keyboard.push([{ text: "⬅️ پنل مدیریت", callback_data: "menu:home" }]);
		return this.s.telegram.editMessage(message.chat.id, message.message_id, lines.join("\n"), { inline_keyboard: keyboard });
	}

	async #showAdminDetail(message, admin, userId) {
		const row = await this.s.admins.get(userId);
		if (!row) return this.#showAdmins(message, admin);
		const name = row.first_name || row.username || row.user_id;
		const keyboard = [];
		if (admin.role === "owner") {
			keyboard.push([{ text: Number(row.is_active) === 1 ? "⏸ غیرفعال" : "▶️ فعال", callback_data: `admins:toggle:${row.user_id}` }]);
			keyboard.push([{ text: "🗑 حذف ادمین", callback_data: `admins:delete:${row.user_id}` }]);
		}
		keyboard.push([{ text: "⬅️ مدیریت ادمین‌ها", callback_data: "admins:home" }]);
		return this.s.telegram.editMessage(message.chat.id, message.message_id,
			`<b>👤 ${escapeHtml(name)}</b>\n\nID: <code>${escapeHtml(row.user_id)}</code>\nStatus: <b>${Number(row.is_active) === 1 ? "فعال" : "غیرفعال"}</b>`, { inline_keyboard: keyboard });
	}

	async #handleAddAdminInput(message, admin) {
		if (admin.role !== "owner") return;
		const targetId = normalizeDigits(String(message.text || "").trim());
		if (!/^\d{5,20}$/.test(targetId)) return this.s.telegram.sendMessage(message.chat.id, "🔴 آیدی عددی معتبر نیست.");
		if (targetId === this.s.config.ownerId) return this.s.telegram.sendMessage(message.chat.id, "ℹ️ این شناسه متعلق به مالک است.");
		await this.s.admins.add(targetId, message.from.id);
		await this.s.adminInput.clear(message.from.id);
		await this.s.audit.add(message.from.id, "admin.added", { targetId });
		return this.s.telegram.sendMessage(message.chat.id, `✅ ادمین <code>${escapeHtml(targetId)}</code> اضافه شد.`, { inline_keyboard: [[{ text: "👥 مدیریت ادمین‌ها", callback_data: "admins:home" }]] });
	}

	#disabledText(admin) {
		return `<b>⏸ ${escapeHtml(this.s.config.displayName)}</b>\n\n<blockquote>🔴 سیستم غیرفعال است</blockquote>\n\nنقش: <b>${admin.role === "owner" ? "مالک" : "ادمین"}</b>`;
	}
}

/** Dependency composition root. */
function createServices(env) {
	const config = new Config(env);
	const settings = new SettingsRepository(env);
	const cache = new MarketCacheRepository(env);
	const locks = new LockRepository(env);
	const statuses = new SourceStatusRepository(env);
	const assets = new AssetRepository(env, config);
	const admins = new AdminRepository(env, config);
	const adminInput = new AdminInputRepository(env);
	const audit = new AuditRepository(env);
	const http = new HttpClient();
	const coinGecko = new CoinGeckoClient(env, config, http);
	const sources = new MarketSources(env, http, statuses);
	const market = new MarketService(env, config, settings, cache, locks, assets, statuses, sources, coinGecko);
	const telegram = new TelegramClient(env);
	const postBuilder = new MarketPostBuilder(config);
	const publisher = new MarketPublisher(config, telegram, postBuilder);
	const automation = new AutomationService(env, config, settings, market, publisher);
	return { env, config, settings, cache, locks, statuses, assets, admins, adminInput, audit, http, coinGecko, sources, market, telegram, postBuilder, publisher, automation };
}

/** Application entrypoint controller. */
class Application {
	constructor(env) {
		this.env = env;
		this.database = new Database(env);
		this.services = createServices(env);
		this.api = new ApiController(this.services);
		this.bot = new BotController(this.services);
	}

	async fetch(request) {
		await this.database.ensureReady();
		const url = new URL(request.url);
		const apiResponse = await this.api.route(request, url);
		if (apiResponse) return apiResponse;
		if (request.method === "POST" && url.pathname === "/telegram/webhook") return this.bot.handleWebhook(request);
		return jsonResponse({ success: false, message: "Not found" }, 404);
	}

	async scheduled() {
		// Deliberately do not run schema bootstrap/migrations on every minute Cron.
		return this.services.automation.tick();
	}
}

/** Fail-fast component contract to catch accidental method deletion before deployment traffic. */
function runtimeIntegrity() {
	const contracts = [
		[MarketPostBuilder.prototype, "buildRichMessage"],
		[MarketService.prototype, "getSnapshot"],
		[CoinGeckoClient.prototype, "fetchMarketBundle"],
		[TelegramClient.prototype, "sendRichMessage"],
		[AutomationService.prototype, "tick"],
	];
	return contracts.every(([target, method]) => typeof target?.[method] === "function");
}

if (!runtimeIntegrity()) throw new Error("Runtime integrity check failed");

export default {
	async fetch(request, env, ctx) {
		try {
			return await new Application(env).fetch(request, ctx);
		} catch (error) {
			console.error("http.unhandled_error", { message: errorMessage(error), stack: error?.stack || null });
			return jsonResponse({ success: false, message: "Internal server error", error: errorMessage(error) }, 500);
		}
	},

	async scheduled(controller, env, ctx) {
		try {
			await new Application(env).scheduled(controller, ctx);
		} catch (error) {
			console.error("cron.unhandled_error", { message: errorMessage(error), stack: error?.stack || null });
			throw error;
		}
	},
};

/* ============================================================
 * PURE HELPERS
 * ============================================================
 */

function success(price = null, status = 200) { return { success: true, price, status, message: null }; }
function failure(message, status = null, latency = null) { return { success: false, status, latency, message: String(message || "Unknown error"), price: null }; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function capitalize(value) { return String(value).charAt(0).toUpperCase() + String(value).slice(1); }
function chunk(items, size) { const rows = []; for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size)); return rows; }
function safeJson(value, fallback = null) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function nullableNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function parseBoolean(value, fallback = false) {
	if (value === undefined || value === null || value === "") return fallback;
	return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}
function normalizeTimestamp(value) { const number = Number(value || 0); return Number.isFinite(number) && number > 0 ? number : 0; }
function normalizeDigits(value) {
	return String(value).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}
function normalizePublishInterval(value) {
	const number = Number(value);
	return APP.publishIntervals.includes(number) ? number : APP.defaultPublishIntervalMinutes;
}
function pad2(value) { return String(Number(value)).padStart(2, "0"); }
function validTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")); }
function timeToMinutes(value) { const [h, m] = String(value).split(":").map(Number); return h * 60 + m; }
function sourceLabel(source) { return ({ wallex: "Wallex", tabdeal: "Tabdeal", exir: "Exir", coingecko: "CoinGecko", wallgold: "WallGold" })[source] || source; }
function coinNameFa(id, fallback = "") { return COIN_NAMES_FA[id] || fallback || id; }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function errorMessage(error) { return error instanceof Error ? error.message : String(error || "Unknown error"); }

function toFaDigits(value) { return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]); }
function formatFaInteger(value) { const number = nullableNumber(value); return number == null ? "نامشخص" : toFaDigits(integerFormatter.format(number).replace(/,/g, "٬")); }
function formatFaPrice(value) {
	const number = nullableNumber(value); if (number == null) return "نامشخص";
	const formatter = Math.abs(number) >= 1 ? priceLargeFormatter : priceSmallFormatter;
	return toFaDigits(formatter.format(number).replace(/,/g, "٬").replace(/\./g, "٫"));
}
function formatOptionalToman(value) { const number = nullableNumber(value); return number == null ? "<b>نامشخص</b>" : `<b>${formatFaInteger(number)} تومان</b>`; }
function formatOptionalUsd(value) { const number = nullableNumber(value); return number == null ? "<b>نامشخص</b>" : `<b>${formatFaPrice(number)} دلار</b>`; }
function changeIcon(value) { const number = nullableNumber(value); return number == null || number === 0 ? "⚪" : number > 0 ? "🟢" : "🔴"; }
function formatFaChangeValue(value) {
	const number = nullableNumber(value); if (number == null) return "<b>نامشخص</b>";
	const sign = number > 0 ? "+" : number < 0 ? "−" : "";
	return `<b>${sign}${formatFaPrice(Math.abs(number))}٪</b>`;
}
function roundToNearest(value, step) { const number = nullableNumber(value); return number == null ? null : Math.round(number / step) * step; }
function calculateMazanehFromGram18(value) { const gram = nullableNumber(value); return gram && gram > 0 ? Math.round(gram * 4.6083 * (705 / 750)) : null; }

function getDateTimeFormatter(config, kind) {
	const key = `${config.timezone}:${kind}`;
	if (dateTimeFormatterCache.has(key)) return dateTimeFormatterCache.get(key);
	const options = kind === "time"
		? { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", hour12: false }
		: kind === "date"
			? { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }
			: { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
	const locale = kind === "date" || kind === "time" ? "fa-IR-u-ca-persian" : "en-CA";
	const formatter = new Intl.DateTimeFormat(locale, options);
	dateTimeFormatterCache.set(key, formatter);
	return formatter;
}
function formatIranDate(config, timestamp) { return getDateTimeFormatter(config, "date").format(new Date(timestamp)).replace(/\//g, "/"); }
function formatIranTime(config, timestamp) { return getDateTimeFormatter(config, "time").format(new Date(timestamp)); }
function formatSystemDate(config, timestamp) { return new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp)); }
function formatSystemTime(config, timestamp) { return new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp)); }
function formatSystemDateTime(config, timestamp) { return `${formatSystemDate(config, timestamp)} · ${formatSystemTime(config, timestamp)}`; }
function formatOptionalSystemDateTime(config, timestamp) { return timestamp ? escapeHtml(formatSystemDateTime(config, timestamp)) : "نامشخص"; }

function getCurrentMinutes(config, timestamp = Date.now()) {
	const parts = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(timestamp));
	const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
	const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
	return hour * 60 + minute;
}
function isInsideQuietHours(config, quietHours, timestamp = Date.now()) {
	const now = getCurrentMinutes(config, timestamp);
	const start = timeToMinutes(quietHours.start); const end = timeToMinutes(quietHours.end);
	if (start === end) return true;
	return start < end ? now >= start && now < end : now >= start || now < end;
}
function calculateNextPublishAt(automation) {
	if (!automation.enabled) return 0;
	const base = automation.lastRunAt || Date.now();
	return base + automation.intervalMinutes * 60 * 1000;
}

function resolveUsdtChecks(checks) {
	for (let index = 0; index < USDT_SOURCE_PRIORITY.length; index += 1) {
		const source = USDT_SOURCE_PRIORITY[index];
		const item = checks?.[source];
		if (item?.success && nullableNumber(item.price) != null) {
			return { ...item, source, sourceLabel: sourceLabel(source), fallbackLevel: index };
		}
	}
	return failure("All USDT sources failed");
}

function resolveUsdtFromStatuses(statuses) {
	for (let index = 0; index < USDT_SOURCE_PRIORITY.length; index += 1) {
		const key = USDT_SOURCE_PRIORITY[index]; const item = statuses[key];
		if (item?.success && nullableNumber(item.price) != null) return {
			available: true, selected_source: sourceLabel(key), price_toman: nullableNumber(item.price), fallback_level: index, latency_ms: item.latency ?? null,
		};
	}
	return { available: false, selected_source: null, price_toman: null, fallback_level: null, latency_ms: null };
}
function sourceStatusText(label, status, role = null) {
	const prefix = status?.success ? "🟢" : "🔴";
	const parts = [`${prefix} <b>${escapeHtml(label)}</b>${role ? ` · <code>${escapeHtml(role)}</code>` : ""}`];
	if (status?.status != null) parts.push(`HTTP: <code>${status.status}</code>`);
	if (status?.latency != null) parts.push(`Latency: <code>${status.latency}ms</code>`);
	if (status?.message) parts.push(`<code>${escapeHtml(String(status.message).slice(0, 180))}</code>`);
	return parts.join("\n");
}
function backKeyboard(label, callback) { return { inline_keyboard: [[{ text: `⬅️ ${label}`, callback_data: callback }]] }; }
function normalizeCommand(text) {
	const first = String(text || "").trim().split(/\s+/)[0].toLowerCase();
	return first.replace(/@[^\s]+$/, "");
}

function serializeMarketSnapshot(config, snapshot) {
	return {
		generated_at: new Date(snapshot.createdAt).toISOString(),
		timezone: config.timezone,
		date: formatIranDate(config, snapshot.createdAt),
		time: formatIranTime(config, snapshot.createdAt),
		partial: Boolean(snapshot.partial),
		cache: snapshot.cache ? {
			from_cache: Boolean(snapshot.cache.fromCache),
			stale_fallback: Boolean(snapshot.cache.staleFallback),
			fetched_at: new Date(snapshot.cache.fetchedAt).toISOString(),
			expires_at: new Date(snapshot.cache.expiresAt).toISOString(),
			ttl_seconds: snapshot.cache.ttlSeconds,
			last_error: snapshot.cache.lastError || null,
		} : null,
		errors: snapshot.errors || [],
		usdt: {
			available: snapshot.usdt?.price != null,
			price_toman: snapshot.usdt?.price ?? null,
			source: snapshot.usdt?.source ?? null,
			fallback_level: snapshot.usdt?.fallbackLevel ?? null,
		},
		crypto: (snapshot.crypto || []).map((item) => ({
			id: item.id, name: item.name, name_fa: coinNameFa(item.id, item.name), symbol: item.symbol,
			available: item.price != null, price_usd: item.price ?? null,
			change_24h_percent: item.change24h ?? null, market_cap_rank: item.marketCapRank ?? null,
		})),
		metals: {
			gram_18_toman: snapshot.metals?.gram18 ?? null,
			mazaneh_toman: snapshot.metals?.mazaneh ?? null,
			gold_usd: snapshot.metals?.gold ?? null,
			silver_usd: snapshot.metals?.silver ?? null,
		},
	};
}
function serializeAutomation(config, a) {
	return {
		enabled: a.enabled, interval_minutes: a.intervalMinutes, quiet_hours: a.quietHours,
		last_run_at: a.lastRunAt ? new Date(a.lastRunAt).toISOString() : null,
		last_success_at: a.lastSuccessAt ? new Date(a.lastSuccessAt).toISOString() : null,
		last_tick_at: a.lastTickAt ? new Date(a.lastTickAt).toISOString() : null,
		last_attempt_at: a.lastAttemptAt ? new Date(a.lastAttemptAt).toISOString() : null,
		last_error_at: a.lastErrorAt ? new Date(a.lastErrorAt).toISOString() : null,
		last_skip_reason: a.lastSkipReason || null, last_error: a.lastError || null, timezone: config.timezone,
	};
}

async function databaseStatus(services) {
	const started = Date.now();
	let connected = false;
	try { await services.env.DB.prepare("SELECT 1 AS ok").first(); connected = true; } catch { connected = false; }
	const latencyMs = Date.now() - started;
	const tables = ["admins", "settings", "source_status", "coingecko_assets", "audit_logs", "market_cache", "runtime_locks"];
	const records = {};
	for (const table of tables) {
		try { const row = await services.env.DB.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).first(); records[table] = Number(row?.count || 0); }
		catch { records[table] = 0; }
	}
	return { connected, provider: "Cloudflare D1", latency_ms: latencyMs, storage: await d1StorageUsage(services), records, schema_version: APP.schemaVersion };
}
async function d1StorageUsage(services) {
	const { env } = services;
	const totalMb = Number(env.D1_DATABASE_LIMIT_MB || 500);
	if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_D1_DATABASE_ID || !env.CLOUDFLARE_API_TOKEN) {
		return { available: false, used_mb: 0, total_mb: totalMb, remaining_mb: totalMb, percent: 0, bar: "░░░░░░░░░░░░" };
	}
	try {
		const response = await new HttpClient().fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${env.CLOUDFLARE_D1_DATABASE_ID}`,
			{ headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, Accept: "application/json" } }, 8000);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();
		const bytes = Number(data?.result?.file_size || 0);
		const usedMb = bytes / 1024 / 1024; const percent = totalMb > 0 ? Math.min(100, (usedMb / totalMb) * 100) : 0;
		const filled = Math.round((percent / 100) * 12);
		return { available: true, used_mb: usedMb, total_mb: totalMb, remaining_mb: Math.max(0, totalMb - usedMb), percent, bar: "█".repeat(filled) + "░".repeat(12 - filled) };
	} catch (error) {
		return { available: false, error: errorMessage(error), used_mb: 0, total_mb: totalMb, remaining_mb: totalMb, percent: 0, bar: "░░░░░░░░░░░░" };
	}
}

function jsonResponse(payload, status = 200) {
	return new Response(JSON.stringify(payload), { status, headers: {
		"Content-Type": "application/json; charset=utf-8",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-Telegram-Bot-Api-Secret-Token",
	} });
}
function corsResponse() { return new Response(null, { status: 204, headers: {
	"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, X-Telegram-Bot-Api-Secret-Token", "Access-Control-Max-Age": "86400",
} }); }
