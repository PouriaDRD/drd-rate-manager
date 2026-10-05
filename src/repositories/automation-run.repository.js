import { safeJson } from "../utils/core.js";

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
const RETAIN_ROWS = 200;
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

export class AutomationRunRepository {
	constructor(env) {
		this.env = env;
	}

	async add(record) {
		const now = Date.now();
		const startedAt = Number(record.startedAt || now);
		const finishedAt = Number(record.finishedAt || now);
		const result = await this.env.DB.prepare(`INSERT INTO automation_runs (
			mode, status, reason, slot_at, started_at, finished_at, actor_type, actor_id,
			message_id, partial, error, details
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
			.bind(
				String(record.mode || "scheduled"),
				String(record.status || "success"),
				record.reason ? String(record.reason) : null,
				Number(record.slotAt || 0),
				startedAt,
				finishedAt,
				String(record.actorType || "system"),
				record.actorId == null ? null : String(record.actorId),
				record.messageId == null ? null : Number(record.messageId),
				record.partial ? 1 : 0,
				record.error ? String(record.error).slice(0, 1000) : null,
				record.details == null ? null : JSON.stringify(record.details),
			)
			.run();
		await this.prune();
		return Number(result?.meta?.last_row_id || 0);
	}

	async list(limit = DEFAULT_HISTORY_LIMIT) {
		const safeLimit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number(limit) || DEFAULT_HISTORY_LIMIT));
		const result = await this.env.DB.prepare(`SELECT
			id, mode, status, reason, slot_at, started_at, finished_at, actor_type, actor_id,
			message_id, partial, error, details
			FROM automation_runs ORDER BY id DESC LIMIT ?`)
			.bind(safeLimit)
			.all();
		return (result.results || []).map((row) => ({
			id: Number(row.id),
			mode: String(row.mode),
			status: String(row.status),
			reason: row.reason || null,
			slotAt: Number(row.slot_at || 0),
			startedAt: Number(row.started_at || 0),
			finishedAt: Number(row.finished_at || 0),
			actorType: String(row.actor_type || "system"),
			actorId: row.actor_id == null ? null : String(row.actor_id),
			messageId: row.message_id == null ? null : Number(row.message_id),
			partial: Number(row.partial) === 1,
			error: row.error || null,
			details: safeJson(row.details, null),
		}));
	}

	async prune(now = Date.now()) {
		await this.env.DB.prepare(`DELETE FROM automation_runs
			WHERE finished_at < ?
			OR id NOT IN (
				SELECT id FROM automation_runs ORDER BY id DESC LIMIT ?
			)`)
			.bind(now - RETAIN_MS, RETAIN_ROWS)
			.run();
	}
}

export const AUTOMATION_HISTORY_LIMITS = Object.freeze({
	default: DEFAULT_HISTORY_LIMIT,
	max: MAX_HISTORY_LIMIT,
	retainRows: RETAIN_ROWS,
	retainMs: RETAIN_MS,
});
