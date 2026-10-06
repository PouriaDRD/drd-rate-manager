const encoder = new TextEncoder();

export const API_TOKEN_TYPES = Object.freeze({
	MARKET: "market",
	CORE: "core",
});

export const API_TOKEN_PREFIXES = Object.freeze({
	market: "drd_mkt_",
	core: "drd_core_",
});

const VALID_TYPES = new Set(Object.values(API_TOKEN_TYPES));
const TOKEN_BYTES = 32;
const DISPLAY_SECRET_CHARS = 8;

function cryptoApi(value = globalThis.crypto) {
	if (!value?.subtle || !value?.getRandomValues) {
		throw new Error("Web Crypto API is unavailable");
	}
	return value;
}

function base64Url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function normalizeType(value) {
	const type = String(value || "").trim().toLowerCase();
	if (!VALID_TYPES.has(type)) throw new Error("Invalid API token type.");
	return type;
}

function normalizeName(value) {
	const name = String(value || "").trim();
	if (!name || name.length > 80) {
		throw new Error("API token name must be between 1 and 80 characters.");
	}
	return name;
}

function bearerToken(request) {
	const value = String(request?.headers?.get?.("Authorization") || "").trim();
	const match = /^Bearer\s+(\S+)$/i.exec(value);
	return match ? match[1] : null;
}

export async function hashApiToken(rawToken, cryptoRef = globalThis.crypto) {
	const digest = await cryptoApi(cryptoRef).subtle.digest(
		"SHA-256",
		encoder.encode(String(rawToken)),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export class ApiTokenService {
	constructor(repository, { cryptoRef = globalThis.crypto, now = () => Date.now() } = {}) {
		this.repository = repository;
		this.crypto = cryptoApi(cryptoRef);
		this.now = now;
	}

	async issue({
		name,
		type,
		expiresAt = 0,
		createdByType = "system",
		createdById = null,
	}) {
		const normalizedType = normalizeType(type);
		const normalizedName = normalizeName(name);
		const now = this.now();
		const normalizedExpiry = Number(expiresAt || 0);
		if (
			!Number.isFinite(normalizedExpiry) ||
			normalizedExpiry < 0 ||
			(normalizedExpiry > 0 && normalizedExpiry <= now)
		) {
			throw new Error("API token expiration must be in the future or zero.");
		}

		const secret = new Uint8Array(TOKEN_BYTES);
		this.crypto.getRandomValues(secret);
		const prefix = API_TOKEN_PREFIXES[normalizedType];
		const encodedSecret = base64Url(secret);
		const rawToken = `${prefix}${encodedSecret}`;
		const tokenHash = await hashApiToken(rawToken, this.crypto);
		const displayPrefix = `${prefix}${encodedSecret.slice(0, DISPLAY_SECRET_CHARS)}`;

		const record = await this.repository.create({
			name: normalizedName,
			type: normalizedType,
			prefix: displayPrefix,
			tokenHash,
			expiresAt: normalizedExpiry,
			createdByType: String(createdByType || "system"),
			createdById:
				createdById == null ? null : String(createdById),
			createdAt: now,
		});

		return {
			token: rawToken,
			record,
		};
	}

	async authenticate(request, expectedType) {
		const scope = normalizeType(expectedType);
		const rawToken = bearerToken(request);
		if (!rawToken) {
			return { ok: false, status: 401, reason: "missing_token" };
		}

		const recognizedType = this.#typeFromRawToken(rawToken);
		if (!recognizedType) {
			return { ok: false, status: 401, reason: "invalid_token" };
		}

		const tokenHash = await hashApiToken(rawToken, this.crypto);
		const record = await this.repository.findByHash(tokenHash);
		if (!record) {
			return { ok: false, status: 401, reason: "invalid_token" };
		}
		if (record.type !== recognizedType) {
			return { ok: false, status: 401, reason: "invalid_token" };
		}
		if (record.type !== scope) {
			return {
				ok: false,
				status: 403,
				reason: "wrong_scope",
				token: this.#publicRecord(record),
			};
		}

		const now = this.now();
		if (record.revokedAt > 0) {
			return { ok: false, status: 401, reason: "token_revoked" };
		}
		if (!record.enabled) {
			return { ok: false, status: 401, reason: "token_disabled" };
		}
		if (record.expiresAt > 0 && record.expiresAt <= now) {
			return { ok: false, status: 401, reason: "token_expired" };
		}

		await this.repository.touchUsage(record.id, now);
		return {
			ok: true,
			status: 200,
			reason: "authenticated",
			token: this.#publicRecord({
				...record,
				lastUsedAt: now,
				usageCount: Number(record.usageCount || 0) + 1,
			}),
		};
	}

	async list(type = null) {
		const normalizedType =
			type == null || type === "" ? null : normalizeType(type);
		return this.repository.list(normalizedType);
	}

	async setEnabled(id, enabled) {
		const record = await this.repository.setEnabled(
			Number(id),
			Boolean(enabled),
			this.now(),
		);
		if (!record) throw new Error("API token not found.");
		return record;
	}

	async revoke(id) {
		const record = await this.repository.revoke(Number(id), this.now());
		if (!record) throw new Error("API token not found.");
		return record;
	}

	#typeFromRawToken(rawToken) {
		if (rawToken.startsWith(API_TOKEN_PREFIXES.market)) return "market";
		if (rawToken.startsWith(API_TOKEN_PREFIXES.core)) return "core";
		return null;
	}

	#publicRecord(record) {
		return {
			id: Number(record.id),
			name: String(record.name || ""),
			type: String(record.type || ""),
			prefix: String(record.prefix || ""),
			enabled: Boolean(record.enabled),
			expiresAt: Number(record.expiresAt || 0),
			lastUsedAt: Number(record.lastUsedAt || 0),
			usageCount: Number(record.usageCount || 0),
			revokedAt: Number(record.revokedAt || 0),
			createdByType: String(record.createdByType || "system"),
			createdById:
				record.createdById == null ? null : String(record.createdById),
			createdAt: Number(record.createdAt || 0),
			updatedAt: Number(record.updatedAt || 0),
		};
	}
}
