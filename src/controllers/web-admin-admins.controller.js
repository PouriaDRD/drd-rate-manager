import { adminEmptyResponse, adminJsonResponse } from "../http/admin-responses.js";

const MAX_BODY_BYTES = 8_192;

async function readJson(request) {
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
		throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
	}
	try {
		return JSON.parse(text || "{}");
	} catch {
		throw Object.assign(new Error("Invalid JSON body."), { statusCode: 400 });
	}
}

function isoOrNull(timestamp) {
	return timestamp ? new Date(timestamp).toISOString() : null;
}

function serializeAdmin(admin) {
	return {
		user_id: admin.userId,
		role: admin.role,
		active: Boolean(admin.active),
		immutable: Boolean(admin.immutable),
		username: admin.username,
		first_name: admin.firstName,
		last_name: admin.lastName,
		display_name: admin.displayName,
		added_by: admin.addedBy,
		created_at: isoOrNull(admin.createdAt),
		last_activity_at: isoOrNull(admin.updatedAt),
	};
}

function webOwnerActor(auth) {
	return {
		type: "web",
		role: "owner",
		id: String(auth.user.id),
	};
}

export class WebAdminAdminsController {
	constructor(services) {
		this.s = services;
	}

	async route(request, url) {
		const state = await this.s.webAuth.routingState();
		const base = `/${state.adminPath}`;
		const root = `${base}/api/v1/admins`;
		if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return null;
		if (request.method === "OPTIONS") return adminEmptyResponse(204);

		const mutation = !["GET", "HEAD"].includes(request.method);
		const auth = await this.s.webAuth.authenticate(request, { requireCsrf: mutation });
		if (!auth) return adminJsonResponse({ success: false, message: "Unauthorized" }, 401);
		if (Number(auth.user.must_complete_bootstrap)) {
			return adminJsonResponse({ success: false, message: "Complete bootstrap first." }, 403);
		}

		const actor = webOwnerActor(auth);
		try {
			if (url.pathname === root) {
				if (request.method === "GET") {
					const snapshot = await this.s.adminManagement.snapshot(actor);
					return adminJsonResponse({
						success: true,
						data: {
							admins: snapshot.admins.map(serializeAdmin),
							stats: {
								total: snapshot.stats.total,
								active_admins: snapshot.stats.activeAdmins,
								inactive_admins: snapshot.stats.inactiveAdmins,
								owner_configured: snapshot.stats.ownerConfigured,
							},
							capabilities: {
								can_manage: snapshot.capabilities.canManage,
							},
						},
					});
				}
				if (request.method === "POST") {
					const body = await readJson(request);
					const admin = await this.s.adminManagement.add(body.user_id, actor);
					return adminJsonResponse({ success: true, data: serializeAdmin(admin) }, 201);
				}
				return adminJsonResponse({ success: false, message: "Method not allowed" }, 405);
			}

			const suffix = url.pathname.slice(root.length + 1);
			if (!suffix || suffix.includes("/")) {
				return adminJsonResponse({ success: false, message: "Not found" }, 404);
			}
			const userId = decodeURIComponent(suffix);

			if (request.method === "GET") {
				const admin = await this.s.adminManagement.get(userId, actor);
				if (!admin) return adminJsonResponse({ success: false, message: "Admin not found" }, 404);
				return adminJsonResponse({ success: true, data: serializeAdmin(admin) });
			}
			if (request.method === "PATCH") {
				const body = await readJson(request);
				const admin = await this.s.adminManagement.setEnabled(userId, body.enabled, actor);
				return adminJsonResponse({ success: true, data: serializeAdmin(admin) });
			}
			if (request.method === "DELETE") {
				const result = await this.s.adminManagement.remove(userId, actor);
				return adminJsonResponse({
					success: true,
					data: { removed: result.removed, user_id: result.userId },
				});
			}
			return adminJsonResponse({ success: false, message: "Method not allowed" }, 405);
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
