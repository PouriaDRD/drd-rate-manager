const VALID_TOKEN_TYPES = new Set(["market", "core"]);

export class ApiManagementError extends Error {
	constructor(message, statusCode = 400, code = "api_management_error") {
		super(message);
		this.name = "ApiManagementError";
		this.statusCode = statusCode;
		this.code = code;
	}
}

function actorReference(actor) {
	const type = String(actor?.type || "unknown").trim() || "unknown";
	const id = actor?.id == null ? "unknown" : String(actor.id);
	return `${type}:${id}`;
}

function normalizeTokenId(value) {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id <= 0) {
		throw new ApiManagementError("Invalid API token ID.", 400, "invalid_token_id");
	}
	return id;
}

function normalizeTokenType(value) {
	const type = String(value || "").trim().toLowerCase();
	if (!VALID_TOKEN_TYPES.has(type)) {
		throw new ApiManagementError(
			"API token type must be market or core.",
			400,
			"invalid_token_type",
		);
	}
	return type;
}

function normalizeTokenName(value) {
	const name = String(value || "").trim();
	if (!name || name.length > 80) {
		throw new ApiManagementError(
			"API token name must be between 1 and 80 characters.",
			400,
			"invalid_token_name",
		);
	}
	return name;
}

function normalizeExpiration(value, now = Date.now()) {
	if (value == null || value === "" || Number(value) === 0) return 0;

	let timestamp;
	if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
		timestamp = Number(value);
	} else {
		timestamp = Date.parse(String(value));
	}

	if (!Number.isFinite(timestamp) || timestamp <= now) {
		throw new ApiManagementError(
			"API token expiration must be a future timestamp or empty.",
			400,
			"invalid_expiration",
		);
	}
	return Math.trunc(timestamp);
}

function publicToken(token) {
	return {
		id: Number(token.id),
		name: String(token.name || ""),
		type: String(token.type || ""),
		prefix: String(token.prefix || ""),
		enabled: Boolean(token.enabled),
		expiresAt: Number(token.expiresAt || 0),
		lastUsedAt: Number(token.lastUsedAt || 0),
		usageCount: Number(token.usageCount || 0),
		revokedAt: Number(token.revokedAt || 0),
		createdByType: String(token.createdByType || "system"),
		createdById: token.createdById == null ? null : String(token.createdById),
		createdAt: Number(token.createdAt || 0),
		updatedAt: Number(token.updatedAt || 0),
	};
}

export class ApiManagementService {
	constructor(apiTokens, apiAccess, audit, { now = () => Date.now() } = {}) {
		this.apiTokens = apiTokens;
		this.apiAccess = apiAccess;
		this.audit = audit;
		this.now = now;
	}

	async snapshot(actor) {
		this.#requireOwner(actor);
		const [mode, tokens] = await Promise.all([
			this.apiAccess.marketMode(),
			this.apiTokens.list(),
		]);
		const safeTokens = tokens.map(publicToken);
		return {
			marketMode: mode,
			tokens: safeTokens,
			stats: {
				total: safeTokens.length,
				active: safeTokens.filter((item) => this.#active(item)).length,
				market: safeTokens.filter((item) => item.type === "market").length,
				core: safeTokens.filter((item) => item.type === "core").length,
				revoked: safeTokens.filter((item) => item.revokedAt > 0).length,
			},
			capabilities: {
				canManage: true,
				canChangeMarketMode: true,
				rawTokensRecoverable: false,
			},
		};
	}

	async create(input, actor) {
		this.#requireOwner(actor);
		const now = this.now();
		const name = normalizeTokenName(input?.name);
		const type = normalizeTokenType(input?.type);
		const expiresAt = normalizeExpiration(input?.expiresAt, now);
		const issued = await this.apiTokens.issue({
			name,
			type,
			expiresAt,
			createdByType: String(actor?.type || "unknown"),
			createdById: actorReference(actor),
		});
		await this.#audit(actor, "api_token.created", {
			tokenId: issued.record.id,
			tokenType: type,
			tokenPrefix: issued.record.prefix,
			expiresAt,
		});
		return {
			token: issued.token,
			record: publicToken(issued.record),
		};
	}

	async setEnabled(tokenId, enabled, actor) {
		this.#requireOwner(actor);
		if (typeof enabled !== "boolean") {
			throw new ApiManagementError(
				"enabled must be a boolean.",
				400,
				"invalid_enabled",
			);
		}
		const token = await this.#getMutableToken(tokenId);
		if (token.enabled === enabled) return token;
		const updated = await this.apiTokens.setEnabled(token.id, enabled);
		await this.#audit(
			actor,
			enabled ? "api_token.enabled" : "api_token.disabled",
			{
				tokenId: token.id,
				tokenType: token.type,
				tokenPrefix: token.prefix,
			},
		);
		return publicToken(updated);
	}

	async revoke(tokenId, actor) {
		this.#requireOwner(actor);
		const token = await this.#findToken(tokenId);
		if (token.revokedAt > 0) return token;
		const updated = await this.apiTokens.revoke(token.id);
		await this.#audit(actor, "api_token.revoked", {
			tokenId: token.id,
			tokenType: token.type,
			tokenPrefix: token.prefix,
		});
		return publicToken(updated);
	}

	async rotate(tokenId, input, actor) {
		this.#requireOwner(actor);
		const current = await this.#getMutableToken(tokenId);
		const now = this.now();
		const hasExpirationOverride =
			input && Object.prototype.hasOwnProperty.call(input, "expiresAt");
		const expiresAt = hasExpirationOverride
			? normalizeExpiration(input.expiresAt, now)
			: current.expiresAt > now
				? current.expiresAt
				: 0;

		const issued = await this.apiTokens.issue({
			name: current.name,
			type: current.type,
			expiresAt,
			createdByType: String(actor?.type || "unknown"),
			createdById: actorReference(actor),
		});

		try {
			await this.apiTokens.revoke(current.id);
		} catch (error) {
			try {
				await this.apiTokens.revoke(issued.record.id);
			} catch {
				// Best-effort rollback: never expose the replacement secret on failure.
			}
			throw error;
		}

		await this.#audit(actor, "api_token.rotated", {
			replacedTokenId: current.id,
			replacementTokenId: issued.record.id,
			tokenType: current.type,
			tokenPrefix: issued.record.prefix,
			expiresAt,
		});

		return {
			token: issued.token,
			record: publicToken(issued.record),
			replacedTokenId: current.id,
		};
	}

	async setMarketMode(mode, actor) {
		this.#requireOwner(actor);
		const previous = await this.apiAccess.marketMode();
		let updated;
		try {
			updated = await this.apiAccess.setMarketMode(mode);
		} catch (error) {
			throw new ApiManagementError(
				String(error?.message || error),
				400,
				"invalid_market_mode",
			);
		}
		if (updated !== previous) {
			await this.#audit(actor, "market_api.mode_changed", {
				previous,
				mode: updated,
			});
		}
		return updated;
	}

	async #findToken(tokenId) {
		const id = normalizeTokenId(tokenId);
		const tokens = await this.apiTokens.list();
		const token = tokens.find((item) => Number(item.id) === id);
		if (!token) {
			throw new ApiManagementError(
				"API token not found.",
				404,
				"token_not_found",
			);
		}
		return publicToken(token);
	}

	async #getMutableToken(tokenId) {
		const token = await this.#findToken(tokenId);
		if (token.revokedAt > 0) {
			throw new ApiManagementError(
				"Revoked API tokens are immutable.",
				409,
				"token_revoked",
			);
		}
		return token;
	}

	#active(token) {
		if (!token.enabled || token.revokedAt > 0) return false;
		return token.expiresAt === 0 || token.expiresAt > this.now();
	}

	#requireOwner(actor) {
		if (String(actor?.role || "") !== "owner") {
			throw new ApiManagementError(
				"Only the owner can manage API access.",
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

export const API_MANAGEMENT_POLICY = Object.freeze({
	ownerOnly: true,
	rawTokenRecoverable: false,
	tokenTypes: Object.freeze(["market", "core"]),
});
