import { WEB_AUTH, clearSessionCookie } from "../auth/web-auth-utils.js";
import { adminEmptyResponse, adminJsonResponse } from "../http/admin-responses.js";
import { errorMessage } from "../utils/core.js";

async function readJson(request) {
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > 16_384) {
		throw new Error("Request body is too large.");
	}
	try {
		return JSON.parse(text || "{}");
	} catch {
		throw new Error("Invalid JSON body.");
	}
}

export class WebAdminAuthController {
	constructor(services) {
		this.s = services;
	}

	async route(request, url, ctx = null) {
		const state = await this.s.webAuth.routingState();
		const base = `/${state.adminPath}`;
		if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null;

		if (request.method === "OPTIONS") return adminEmptyResponse(204);
		if (
			request.method === "GET" &&
			url.pathname === base &&
			typeof this.s.webAuth.authenticate === "function"
		) {
			const auth = await this.s.webAuth.authenticate(request);
			return adminJsonResponse({
				success: true,
				service: "DRD Rate Manager Web Admin",
				authenticated: Boolean(auth),
				must_complete_bootstrap: state.mustCompleteBootstrap,
			});
		}
		if (!url.pathname.startsWith(`${base}/api/`)) return null;

		if (request.method === "POST" && url.pathname === `${base}/api/v1/auth/login`) {
			return this.#login(request, ctx);
		}
		if (request.method === "GET" && url.pathname === `${base}/api/v1/auth/session`) {
			return this.#session(request);
		}
		if (request.method === "POST" && url.pathname === `${base}/api/v1/auth/logout`) {
			return this.#logout(request);
		}
		if (request.method === "POST" && url.pathname === `${base}/api/v1/bootstrap`) {
			return this.#bootstrap(request);
		}
		if (request.method === "POST" && url.pathname === `${base}/api/v1/auth/credentials`) {
			return this.#credentials(request);
		}

		return adminJsonResponse({ success: false, message: "Not found" }, 404);
	}

	async #login(request, ctx) {
		let body;
		try {
			body = await readJson(request);
		} catch (error) {
			return adminJsonResponse({ success: false, message: error.message }, 400);
		}
		const result = await this.s.webAuth.login(request, body.username, body.password);
		await this.#queueLoginSecurityAlert(request, result.securityEvent, ctx);
		if (!result.ok) {
			return adminJsonResponse(
				{
					success: false,
					message: result.error,
					...(result.retryAfterSeconds ? { retry_after_seconds: result.retryAfterSeconds } : {}),
				},
				result.status,
				result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : {},
			);
		}
		return adminJsonResponse(
			{
				success: true,
				user: result.user,
				csrf_token: result.csrfToken,
				bootstrap_required: result.user.mustCompleteBootstrap,
			},
			200,
			{ "Set-Cookie": result.cookie },
		);
	}

	async #queueLoginSecurityAlert(request, event, ctx) {
		if (!event || typeof this.s.webLoginAlerts?.notify !== "function") return;
		const task = Promise.resolve()
			.then(() => this.s.webLoginAlerts.notify(request, event))
			.catch((error) => {
				console.warn({
					timestamp: new Date().toISOString(),
					level: "warn",
					event: "web_auth.login_security_alert_failed",
					message: errorMessage(error).slice(0, 300),
				});
				return null;
			});
		if (typeof ctx?.waitUntil === "function") {
			ctx.waitUntil(task);
			return;
		}
		await task;
	}

	async #session(request) {
		const auth = await this.s.webAuth.authenticate(request);
		if (!auth) return adminJsonResponse({ success: false, message: "Unauthorized" }, 401);
		const csrfToken = await this.s.webAuth.rotateCsrf(auth);
		return adminJsonResponse({
			success: true,
			user: {
				id: Number(auth.user.id),
				username: auth.user.username,
				adminPath: auth.user.admin_path,
				mustCompleteBootstrap: Boolean(Number(auth.user.must_complete_bootstrap)),
				lastLoginAt: Number(auth.user.last_login_at || 0),
			},
			csrf_token: csrfToken,
		});
	}

	async #logout(request) {
		const auth = await this.s.webAuth.authenticate(request, { requireCsrf: true });
		if (!auth) return adminJsonResponse({ success: false, message: "Unauthorized" }, 401);
		const cookie = await this.s.webAuth.logout(auth);
		return adminJsonResponse({ success: true }, 200, { "Set-Cookie": cookie });
	}

	async #bootstrap(request) {
		const auth = await this.s.webAuth.authenticate(request, { requireCsrf: true });
		if (!auth) return adminJsonResponse({ success: false, message: "Unauthorized" }, 401);
		if (!Number(auth.user.must_complete_bootstrap)) {
			return adminJsonResponse({ success: false, message: "Bootstrap is already complete." }, 409);
		}
		try {
			const body = await readJson(request);
			const user = await this.s.webAuth.completeBootstrap(auth, body);
			return adminJsonResponse(
				{
					success: true,
					message: "Bootstrap completed. Sign in again using the new admin path.",
					admin_path: `/${user.adminPath}`,
				},
				200,
				{ "Set-Cookie": clearSessionCookie() },
			);
		} catch (error) {
			return adminJsonResponse({ success: false, message: error.message }, 400);
		}
	}

	async #credentials(request) {
		const auth = await this.s.webAuth.authenticate(request, { requireCsrf: true });
		if (!auth) return adminJsonResponse({ success: false, message: "Unauthorized" }, 401);
		if (Number(auth.user.must_complete_bootstrap)) {
			return adminJsonResponse({ success: false, message: "Complete bootstrap first." }, 403);
		}
		try {
			const body = await readJson(request);
			const user = await this.s.webAuth.changeCredentials(auth, body);
			return adminJsonResponse(
				{
					success: true,
					message: "Credentials updated. Sign in again.",
					admin_path: `/${user.adminPath}`,
				},
				200,
				{ "Set-Cookie": clearSessionCookie() },
			);
		} catch (error) {
			return adminJsonResponse({ success: false, message: error.message }, 400);
		}
	}
}

export { WEB_AUTH };
