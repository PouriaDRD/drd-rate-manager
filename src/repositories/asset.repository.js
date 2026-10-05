import { coinNameFa } from "../utils/core.js";

export class AssetRepository {
	constructor(env, config) {
		this.env = env;
		this.config = config;
	}

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

	async setEnabled(coinId, enabled) {
		const row = await this.env.DB.prepare(
			"SELECT 1 AS ok FROM coingecko_assets WHERE coin_id = ? LIMIT 1",
		).bind(coinId).first();
		if (!row) throw new Error("Asset not found");
		await this.env.DB.prepare(
			"UPDATE coingecko_assets SET is_enabled = ?, updated_at = ? WHERE coin_id = ?",
		).bind(enabled ? 1 : 0, Date.now(), coinId).run();
		return Boolean(enabled);
	}

	async toggle(coinId) {
		const row = await this.env.DB.prepare(
			"SELECT is_enabled FROM coingecko_assets WHERE coin_id = ? LIMIT 1",
		).bind(coinId).first();
		if (!row) throw new Error("Asset not found");
		const next = Number(row.is_enabled) === 1 ? 0 : 1;
		await this.env.DB.prepare(
			"UPDATE coingecko_assets SET is_enabled = ?, updated_at = ? WHERE coin_id = ?",
		).bind(next, Date.now(), coinId).run();
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
