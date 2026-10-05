import { normalizeDigits } from "../utils/core.js";

const TELEGRAM_ID_PATTERN = /^\d{5,20}$/;

export class AdminManagementError extends Error {
	constructor(message, statusCode = 400, code = "admin_management_error") {
		super(message);
		this.name = "AdminManagementError";
		this.statusCode = statusCode;
		this.code = code;
	}
}

function displayName(row) {
	const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
	if (fullName) return fullName;
	if (row.username) return `@${row.username}`;
	return String(row.user_id);
}

function actorReference(actor) {
	const type = String(actor?.type || "unknown").trim() || "unknown";
	const id = actor?.id == null ? "unknown" : String(actor.id);
	return `${type}:${id}`;
}

export class AdminManagementService {
	constructor(config, admins, audit) {
		this.config = config;
		this.admins = admins;
		this.audit = audit;
	}

	normalizeTelegramId(value) {
		const normalized = normalizeDigits(String(value ?? "").trim());
		if (!TELEGRAM_ID_PATTERN.test(normalized)) {
			throw new AdminManagementError(
				"Telegram user ID must contain 5 to 20 digits.",
				400,
				"invalid_telegram_id",
			);
		}
		return normalized;
	}

	async snapshot(actor) {
		this.#requireReader(actor);
		const admins = await this.list(actor);
		const activeAdmins = admins.filter((item) => item.role === "admin" && item.active).length;
		const inactiveAdmins = admins.filter((item) => item.role === "admin" && !item.active).length;
		return {
			admins,
			stats: {
				total: admins.length,
				activeAdmins,
				inactiveAdmins,
				ownerConfigured: Boolean(this.config.ownerId),
			},
			capabilities: {
				canManage: actor?.role === "owner",
			},
		};
	}

	async list(actor) {
		this.#requireReader(actor);
		const rows = await this.admins.list();
		const result = [];
		if (this.config.ownerId) result.push(this.#ownerRecord());
		result.push(...rows.map((row) => this.#adminRecord(row)));
		return result;
	}

	async get(userId, actor) {
		this.#requireReader(actor);
		const targetId = this.normalizeTelegramId(userId);
		if (this.#isOwner(targetId)) return this.#ownerRecord();
		const row = await this.admins.get(targetId);
		return row ? this.#adminRecord(row) : null;
	}

	async add(userId, actor) {
		this.#requireOwner(actor);
		const targetId = this.normalizeTelegramId(userId);
		this.#rejectOwnerMutation(targetId);
		await this.admins.add(targetId, actorReference(actor));
		await this.#audit(actor, "admin.added", { targetId });
		return this.get(targetId, actor);
	}

	async setEnabled(userId, enabled, actor) {
		this.#requireOwner(actor);
		if (typeof enabled !== "boolean") {
			throw new AdminManagementError("enabled must be a boolean.", 400, "invalid_enabled");
		}
		const targetId = this.normalizeTelegramId(userId);
		this.#rejectOwnerMutation(targetId);
		const existing = await this.admins.get(targetId);
		if (!existing) {
			throw new AdminManagementError("Admin not found.", 404, "admin_not_found");
		}
		await this.admins.setEnabled(targetId, enabled);
		await this.#audit(actor, enabled ? "admin.enabled" : "admin.disabled", { targetId });
		return this.get(targetId, actor);
	}

	async remove(userId, actor) {
		this.#requireOwner(actor);
		const targetId = this.normalizeTelegramId(userId);
		this.#rejectOwnerMutation(targetId);
		const existing = await this.admins.get(targetId);
		if (!existing) {
			throw new AdminManagementError("Admin not found.", 404, "admin_not_found");
		}
		await this.admins.remove(targetId);
		await this.#audit(actor, "admin.removed", { targetId });
		return { removed: true, userId: targetId };
	}

	#ownerRecord() {
		const userId = String(this.config.ownerId);
		return {
			userId,
			role: "owner",
			active: true,
			immutable: true,
			username: null,
			firstName: null,
			lastName: null,
			displayName: "Owner",
			addedBy: null,
			createdAt: 0,
			updatedAt: 0,
		};
	}

	#adminRecord(row) {
		return {
			userId: String(row.user_id),
			role: "admin",
			active: Number(row.is_active) === 1,
			immutable: false,
			username: row.username || null,
			firstName: row.first_name || null,
			lastName: row.last_name || null,
			displayName: displayName(row),
			addedBy: row.added_by || null,
			createdAt: Number(row.created_at || 0),
			updatedAt: Number(row.updated_at || 0),
		};
	}

	#isOwner(userId) {
		return Boolean(this.config.ownerId) && String(userId) === String(this.config.ownerId);
	}

	#rejectOwnerMutation(userId) {
		if (this.#isOwner(userId)) {
			throw new AdminManagementError(
				"The owner is immutable and cannot be added, disabled, or removed.",
				409,
				"owner_immutable",
			);
		}
	}

	#requireReader(actor) {
		if (!["owner", "admin"].includes(String(actor?.role || ""))) {
			throw new AdminManagementError("Admin access is required.", 403, "forbidden");
		}
	}

	#requireOwner(actor) {
		if (String(actor?.role || "") !== "owner") {
			throw new AdminManagementError(
				"Only the owner can modify administrators.",
				403,
				"owner_required",
			);
		}
	}

	async #audit(actor, action, data) {
		await this.audit?.add?.(actor?.id ?? null, action, {
			...data,
			actorType: actor?.type || "unknown",
			actorRole: actor?.role || "unknown",
		});
	}
}

export const ADMIN_MANAGEMENT_POLICY = Object.freeze({
	telegramIdPattern: TELEGRAM_ID_PATTERN,
	ownerMutable: false,
	adminCanManageAdmins: false,
});
