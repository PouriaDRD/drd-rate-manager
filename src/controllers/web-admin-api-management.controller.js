import {
	adminEmptyResponse,
	adminJsonResponse,
} from "../http/admin-responses.js";

const MAX_BODY_BYTES = 8_192;

async function readJson(request) {
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
		throw Object.assign(new Error("Request body is too large."), {
			statusCode: 413,
			code: "body_too_large",
		});
	}
	try {
		return JSON.parse(text || "{}");
	} catch {
		throw Object.assign(new Error("Invalid JSON body."), {
			statusCode: 400,
			code: "invalid_json",
		});
	}
}

function isoOrNull(timestamp) {
	return timestamp ? new Date(timestamp).toISOString() : null;
}

function serializeToken(token) {
	return {
		id: Number(token.id),
		name: token.name,
		type: token.type,
		prefix: token.prefix,
		enabled: Boolean(token.enabled),
		expires_at: isoOrNull(token.expiresAt),
		last_used_at: isoOrNull(token.lastUsedAt),
		usage_count: Number(token.usageCount || 0),
		revoked_at: isoOrNull(token.revokedAt),
		created_by_type: token.createdByType,
		created_by_id: token.createdById,
		created_at: isoOrNull(token.createdAt),
		updated_at: isoOrNull(token.updatedAt),
	};
}

function serializeSnapshot(snapshot) {
	return {
		market_mode: snapshot.marketMode,
		tokens: snapshot.tokens.map(serializeToken),
		stats: {
			total: snapshot.stats.total,
			active: snapshot.stats.active,
			market: snapshot.stats.market,
			core: snapshot.stats.core,
			revoked: snapshot.stats.revoked,
		},
		capabilities: {
			can_manage: snapshot.capabilities.canManage,
			can_change_market_mode:
				snapshot.capabilities.canChangeMarketMode,
			raw_tokens_recoverable:
				snapshot.capabilities.rawTokensRecoverable,
		},
	};
}

function webOwnerActor(auth) {
	return {
		type: "web",
		role: "owner",
		id: String(auth.user.id),
	};
}

function parseTokenPath(root, pathname) {
	const prefix = `${root}/tokens/`;
	if (!pathname.startsWith(prefix)) return null;
	const suffix = pathname.slice(prefix.length);
	const parts = suffix.split("/").filter(Boolean);
	if (!parts.length || parts.length > 2) return null;
	const id = decodeURIComponent(parts[0]);
	const action = parts[1] || null;
	return { id, action };
}

export class WebAdminApiManagementController {
	constructor(services) {
		this.s = services;
	}

	async route(request, url) {
		const state = await this.s.webAuth.routingState();
		const base = `/${state.adminPath}`;
		const root = `${base}/api/v1/api-management`;
		if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) {
			return null;
		}
		if (request.method === "OPTIONS") return adminEmptyResponse(204);

		const mutation = !["GET", "HEAD"].includes(request.method);
		const auth = await this.s.webAuth.authenticate(request, {
			requireCsrf: mutation,
		});
		if (!auth) {
			return adminJsonResponse(
				{ success: false, message: "Unauthorized" },
				401,
			);
		}
		if (Number(auth.user.must_complete_bootstrap)) {
			return adminJsonResponse(
				{
					success: false,
					message: "Complete bootstrap first.",
				},
				403,
			);
		}

		const actor = webOwnerActor(auth);
		try {
			if (url.pathname === root) {
				if (request.method !== "GET") {
					return adminJsonResponse(
						{ success: false, message: "Method not allowed" },
						405,
					);
				}
				const snapshot = await this.s.apiManagement.snapshot(actor);
				return adminJsonResponse({
					success: true,
					data: serializeSnapshot(snapshot),
				});
			}

			if (url.pathname === `${root}/market-mode`) {
				if (request.method !== "PATCH") {
					return adminJsonResponse(
						{ success: false, message: "Method not allowed" },
						405,
					);
				}
				const body = await readJson(request);
				const mode = await this.s.apiManagement.setMarketMode(
					body.mode,
					actor,
				);
				return adminJsonResponse({
					success: true,
					data: { market_mode: mode },
				});
			}

			if (url.pathname === `${root}/tokens`) {
				if (request.method !== "POST") {
					return adminJsonResponse(
						{ success: false, message: "Method not allowed" },
						405,
					);
				}
				const body = await readJson(request);
				const created = await this.s.apiManagement.create(
					{
						name: body.name,
						type: body.type,
						expiresAt: body.expires_at,
					},
					actor,
				);
				return adminJsonResponse(
					{
						success: true,
						data: {
							token: created.token,
							record: serializeToken(created.record),
							one_time_secret: true,
						},
					},
					201,
				);
			}

			const tokenPath = parseTokenPath(root, url.pathname);
			if (!tokenPath) {
				return adminJsonResponse(
					{ success: false, message: "Not found" },
					404,
				);
			}

			if (tokenPath.action === "rotate") {
				if (request.method !== "POST") {
					return adminJsonResponse(
						{ success: false, message: "Method not allowed" },
						405,
					);
				}
				const body = await readJson(request);
				const rotated = await this.s.apiManagement.rotate(
					tokenPath.id,
					Object.prototype.hasOwnProperty.call(body, "expires_at")
						? { expiresAt: body.expires_at }
						: {},
					actor,
				);
				return adminJsonResponse({
					success: true,
					data: {
						token: rotated.token,
						record: serializeToken(rotated.record),
						replaced_token_id: rotated.replacedTokenId,
						one_time_secret: true,
					},
				});
			}

			if (tokenPath.action) {
				return adminJsonResponse(
					{ success: false, message: "Not found" },
					404,
				);
			}

			if (request.method === "PATCH") {
				const body = await readJson(request);
				const token = await this.s.apiManagement.setEnabled(
					tokenPath.id,
					body.enabled,
					actor,
				);
				return adminJsonResponse({
					success: true,
					data: serializeToken(token),
				});
			}
			if (request.method === "DELETE") {
				const token = await this.s.apiManagement.revoke(
					tokenPath.id,
					actor,
				);
				return adminJsonResponse({
					success: true,
					data: serializeToken(token),
				});
			}

			return adminJsonResponse(
				{ success: false, message: "Method not allowed" },
				405,
			);
		} catch (error) {
			const status = Number(error?.statusCode || 400);
			return adminJsonResponse(
				{
					success: false,
					message: String(error?.message || error),
					...(error?.code ? { code: error.code } : {}),
				},
				status >= 400 && status <= 599 ? status : 400,
			);
		}
	}
}
