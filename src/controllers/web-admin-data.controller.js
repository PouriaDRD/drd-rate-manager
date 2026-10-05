import { serializeAutomation, serializeMarketSnapshot } from "../api/serializers.js";
import { adminEmptyResponse, adminJsonResponse } from "../http/admin-responses.js";

async function readJson(request) {
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > 16_384) throw new Error("Request body is too large.");
	try {
		return JSON.parse(text || "{}");
	} catch {
		throw new Error("Invalid JSON body.");
	}
}

function booleanSetting(value, fallback = true) {
	if (value == null || value === "") return fallback;
	return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}

export class WebAdminDataController {
	constructor(services) {
		this.s = services;
	}

	async route(request, url) {
		const state = await this.s.webAuth.routingState();
		const base = `/${state.adminPath}`;
		if (!url.pathname.startsWith(`${base}/api/v1/`)) return null;
		if (url.pathname.startsWith(`${base}/api/v1/auth/`) || url.pathname === `${base}/api/v1/bootstrap`) return null;
		if (request.method === "OPTIONS") return adminEmptyResponse(204);

		const mutation = !["GET", "HEAD"].includes(request.method);
		const auth = await this.s.webAuth.authenticate(request, { requireCsrf: mutation });
		if (!auth) return adminJsonResponse({ success: false, message: "Unauthorized" }, 401);
		if (Number(auth.user.must_complete_bootstrap)) {
			return adminJsonResponse({ success: false, message: "Complete bootstrap first." }, 403);
		}

		try {
			if (request.method === "GET" && url.pathname === `${base}/api/v1/dashboard`) {
				return this.#dashboard();
			}
			if (request.method === "GET" && url.pathname === `${base}/api/v1/market`) {
				return this.#market(false);
			}
			if (request.method === "POST" && url.pathname === `${base}/api/v1/market/refresh`) {
				return this.#market(true);
			}
			if (request.method === "GET" && url.pathname === `${base}/api/v1/market/preview`) {
				return this.#preview();
			}
			if (request.method === "POST" && url.pathname === `${base}/api/v1/market/publish`) {
				return this.#publish(auth);
			}
			if (request.method === "GET" && url.pathname === `${base}/api/v1/preferences`) {
				await this.s.preferences.refresh();
				return adminJsonResponse({ success: true, data: this.s.preferences.snapshot() });
			}
			if (request.method === "PATCH" && url.pathname === `${base}/api/v1/preferences`) {
				await this.s.preferences.refresh();
				const data = await this.s.preferences.update(await readJson(request));
				return adminJsonResponse({ success: true, data });
			}
		} catch (error) {
			return adminJsonResponse({ success: false, message: String(error?.message || error) }, 400);
		}
		return adminJsonResponse({ success: false, message: "Not found" }, 404);
	}

	async #dashboard() {
		const [snapshot, automation, statuses, assets, botEnabled] = await Promise.all([
			this.s.market.getSnapshot(),
			this.s.automation.getSettings(),
			this.s.statuses.all(),
			this.s.assets.all(),
			this.s.settings.get("bot_enabled", "1"),
		]);
		const sourceRows = Object.entries(statuses || {});
		return adminJsonResponse({
			success: true,
			data: {
				bot_enabled: booleanSetting(botEnabled, true),
				market: serializeMarketSnapshot(this.s.config, snapshot),
				automation: serializeAutomation(this.s.config, automation),
				sources: {
					healthy: sourceRows.filter(([, item]) => item?.success).length,
					total: sourceRows.length,
				},
				assets: {
					total: assets.length,
					enabled: assets.filter((item) => item.enabled).length,
				},
			},
		});
	}

	async #market(forceRefresh) {
		const snapshot = await this.s.market.getSnapshot({ forceRefresh });
		return adminJsonResponse({ success: true, data: serializeMarketSnapshot(this.s.config, snapshot) });
	}

	async #preview() {
		const snapshot = await this.s.market.getSnapshot();
		const rich = this.s.postBuilder.buildRichMessage(snapshot);
		return adminJsonResponse({
			success: true,
			data: {
				rich,
				fallback_html: this.s.postBuilder.buildFallbackHtml(snapshot),
				partial: Boolean(snapshot.partial),
			},
		});
	}

	async #publish(auth) {
		const snapshot = await this.s.market.getSnapshot();
		const result = await this.s.publisher.publish(snapshot);
		await this.s.audit.add(String(auth.user.id), "web.market.manual_published", {
			messageId: result?.message_id ?? null,
			partial: Boolean(snapshot.partial),
		});
		return adminJsonResponse({
			success: true,
			data: { message_id: result?.message_id ?? null, partial: Boolean(snapshot.partial) },
		});
	}
}
