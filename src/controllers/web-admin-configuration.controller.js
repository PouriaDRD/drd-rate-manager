import {
	adminEmptyResponse,
	adminJsonResponse,
} from "../http/admin-responses.js";

const MAX_BODY_BYTES = 16_384;

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

function webActor(auth) {
	return {
		type: "web",
		role: "owner",
		id: String(auth.user.id),
	};
}

function parseSecretPath(root, pathname) {
	const prefix = `${root}/secrets/`;
	if (!pathname.startsWith(prefix)) return null;
	const suffix = pathname.slice(prefix.length);
	if (!suffix || suffix.includes("/")) return null;
	return decodeURIComponent(suffix);
}

export class WebAdminConfigurationController {
	constructor(services) {
		this.s = services;
	}

	async route(request, url) {
		const state = await this.s.webAuth.routingState();
		const base = `/${state.adminPath}`;
		const root = `${base}/api/v1/configuration`;
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
				{ success: false, message: "Complete bootstrap first." },
				403,
			);
		}

		const actor = webActor(auth);
		try {
			if (url.pathname === root) {
				if (request.method !== "GET") {
					return adminJsonResponse(
						{ success: false, message: "Method not allowed" },
						405,
					);
				}
				return adminJsonResponse({
					success: true,
					data: this.s.configurationManagement.snapshot(),
				});
			}

			if (url.pathname === `${root}/runtime`) {
				if (request.method !== "PATCH") {
					return adminJsonResponse(
						{ success: false, message: "Method not allowed" },
						405,
					);
				}
				const body = await readJson(request);
				const data = await this.s.configurationManagement.updateRuntime(
					body.values,
					actor,
				);
				return adminJsonResponse({ success: true, data });
			}

			const secretKey = parseSecretPath(root, url.pathname);
			if (secretKey) {
				if (request.method !== "PATCH") {
					return adminJsonResponse(
						{ success: false, message: "Method not allowed" },
						405,
					);
				}
				const body = await readJson(request);
				const data = await this.s.configurationManagement.replaceSecret(
					{
						key: secretKey,
						value: body.value,
						currentPassword: body.current_password,
						authenticated: auth,
					},
					actor,
				);
				return adminJsonResponse({ success: true, data });
			}

			return adminJsonResponse(
				{ success: false, message: "Not found" },
				404,
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
