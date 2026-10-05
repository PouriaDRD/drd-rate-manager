export class AdminRepository {
	constructor(env, config) {
		this.env = env;
		this.config = config;
	}

	isOwner(userId) {
		return String(userId) === this.config.ownerId && Boolean(this.config.ownerId);
	}

	async resolve(user) {
		if (!user?.id) return null;
		if (this.isOwner(user.id)) {
			return { role: "owner", active: true, userId: String(user.id), user };
		}
		const row = await this.env.DB.prepare("SELECT * FROM admins WHERE user_id = ? LIMIT 1")
			.bind(String(user.id))
			.first();
		if (!row || Number(row.is_active) !== 1) return null;
		return { role: "admin", active: true, userId: String(user.id), row, user };
	}

	async touchProfile(user) {
		if (!user?.id || this.isOwner(user.id)) return;
		await this.env.DB.prepare(
			"UPDATE admins SET username = ?, first_name = ?, last_name = ?, updated_at = ? WHERE user_id = ?",
		)
			.bind(user.username || null, user.first_name || null, user.last_name || null, Date.now(), String(user.id))
			.run();
	}

	async list() {
		const result = await this.env.DB.prepare("SELECT * FROM admins ORDER BY created_at ASC").all();
		return result.results || [];
	}

	async get(userId) {
		return this.env.DB.prepare("SELECT * FROM admins WHERE user_id = ? LIMIT 1")
			.bind(String(userId))
			.first();
	}

	async add(userId, addedBy) {
		const now = Date.now();
		await this.env.DB.prepare(`INSERT INTO admins
			(user_id, username, first_name, last_name, is_active, added_by, created_at, updated_at)
			VALUES (?, NULL, NULL, NULL, 1, ?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET is_active = 1, updated_at = excluded.updated_at`)
			.bind(String(userId), String(addedBy), now, now)
			.run();
	}

	async toggle(userId) {
		const row = await this.get(userId);
		if (!row) throw new Error("Admin not found");
		const next = Number(row.is_active) === 1 ? 0 : 1;
		await this.env.DB.prepare("UPDATE admins SET is_active = ?, updated_at = ? WHERE user_id = ?")
			.bind(next, Date.now(), String(userId))
			.run();
		return next === 1;
	}

	async remove(userId) {
		await this.env.DB.prepare("DELETE FROM admins WHERE user_id = ?")
			.bind(String(userId))
			.run();
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
