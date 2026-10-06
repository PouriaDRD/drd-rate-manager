import { adminJsonResponse, adminRedirect, adminUiResponse } from "../http/admin-responses.js";

const ADMIN_ASSETS = new Set([
	"index.html",
	"assets/styles.css",
	"assets/api.js",
	"assets/i18n.js",
	"assets/app.js",
	"assets/admins.css",
	"assets/admins.js",
	"assets/system.css",
	"assets/system.js",
	"assets/api-management.css",
	"assets/api-management.js",
	"assets/login-history.css",
	"assets/login-history.js",
]);

export class WebAdminUiController {
	constructor(services) {
		this.s = services;
	}

	async route(request, url) {
		if (!new Set(["GET", "HEAD"]).has(request.method)) return null;
		if (url.pathname.includes("/api/")) return null;

		const state = await this.s.webAuth.routingState();
		const base = `/${state.adminPath}`;
		if (url.pathname === base) {
			const target = new URL(request.url);
			target.pathname = `${base}/`;
			return adminRedirect(target.toString());
		}
		if (!url.pathname.startsWith(`${base}/`)) return null;

		const relativePath = url.pathname.slice(base.length + 1) || "index.html";
		if (!ADMIN_ASSETS.has(relativePath)) {
			return adminJsonResponse({ success: false, message: "Not found" }, 404);
		}

		const assets = this.s.rawEnv?.ASSETS || this.s.env?.ASSETS;
		if (!assets?.fetch) {
			return adminJsonResponse({ success: false, message: "Admin assets are unavailable" }, 503);
		}

		const assetUrl = new URL(request.url);
		// Cloudflare Static Assets applies html_handling to ASSETS.fetch().
		// With the default auto-trailing-slash mode, requesting /index.html
		// redirects to /. Request the canonical root directly so the private
		// admin shell receives the actual index.html response instead of a 3xx.
		assetUrl.pathname = relativePath === "index.html" ? "/" : `/${relativePath}`;
		assetUrl.search = "";
		const assetRequest = new Request(assetUrl, request);
		const response = await assets.fetch(assetRequest);
		if (!response.ok) {
			return adminJsonResponse({ success: false, message: "Admin asset not found" }, 404);
		}
		return adminUiResponse(response, { document: relativePath === "index.html" });
	}
}
