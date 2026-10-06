export class SourceStatusRepository {
	constructor(env) {
		this.env = env;
	}

	async save(source, status) {
		if (status?.skipped) return false;
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
			)
			.run();
		return true;
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
		for (const source of ["wallex", "tabdeal", "exir", "bitpin", "nobitex", "coingecko", "wallgold", "technogold", "melligold", "talasea", "milli", "gerami"]) {
			if (!map[source]) {
				map[source] = {
					success: false,
					status: null,
					latency: null,
					message: "No cached data yet",
					price: null,
					lastCheckedAt: 0,
				};
			}
		}
		return map;
	}
}
