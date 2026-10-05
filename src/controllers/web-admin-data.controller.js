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

function requireBoolean(value, field = "enabled") {
	if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
	return value;
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
			if (request.method === "GET" && url.pathname === `${base}/api/v1/sources`) {
				return adminJsonResponse({ success: true, data: await this.s.sourceSettings.snapshot() });
			}
			if (request.method === "PATCH" && url.pathname === `${base}/api/v1/sources/usdt-priority`) {
				const body = await readJson(request);
				const priority = await this.s.sourceSettings.setUsdtPriority(body.priority);
				return adminJsonResponse({ success: true, data: { usdt_priority: priority } });
			}
			const sourceMatch = url.pathname.match(new RegExp(`^${base}/api/v1/sources/([a-z0-9_-]+)$`));
			if (request.method === "PATCH" && sourceMatch) {
				const body = await readJson(request);
				const enabled = await this.s.sourceSettings.setEnabled(sourceMatch[1], requireBoolean(body.enabled));
				return adminJsonResponse({ success: true, data: { source: sourceMatch[1], enabled } });
			}
			const sourceTestMatch = url.pathname.match(new RegExp(`^${base}/api/v1/sources/([a-z0-9_-]+)/test$`));
			if (request.method === "POST" && sourceTestMatch) {
				return adminJsonResponse({ success: true, data: await this.#testSource(sourceTestMatch[1]) });
			}
			if (request.method === "GET" && url.pathname === `${base}/api/v1/assets`) {
				const assets = await this.s.assets.all();
				return adminJsonResponse({ success: true, data: { assets, count: assets.length, enabled_count: assets.filter((item) => item.enabled).length } });
			}
			if (request.method === "POST" && url.pathname === `${base}/api/v1/assets/refresh`) {
				return adminJsonResponse({ success: true, data: await this.#refreshAssets() });
			}
			const assetMatch = url.pathname.match(new RegExp(`^${base}/api/v1/assets/([^/]+)$`));
			if (request.method === "PATCH" && assetMatch) {
				const body = await readJson(request);
				const coinId = decodeURIComponent(assetMatch[1]);
				const enabled = await this.s.assets.setEnabled(coinId, requireBoolean(body.enabled));
				return adminJsonResponse({ success: true, data: { id: coinId, enabled } });
			}
		} catch (error) {
			return adminJsonResponse({ success: false, message: String(error?.message || error) }, 400);
		}
		return adminJsonResponse({ success: false, message: "Not found" }, 404);
	}

	async #dashboard() {
		const [snapshot, automation, sourceSnapshot, assets, botEnabled] = await Promise.all([
			this.s.market.getSnapshot(),
			this.s.automation.getSettings(),
			this.s.sourceSettings.snapshot(),
			this.s.assets.all(),
			this.s.settings.get("bot_enabled", "1"),
		]);
		const sourceRows = Object.values(sourceSnapshot.sources || {}).filter((item) => item.enabled);
		return adminJsonResponse({
			success: true,
			data: {
				bot_enabled: booleanSetting(botEnabled, true),
				market: serializeMarketSnapshot(this.s.config, snapshot),
				automation: serializeAutomation(this.s.config, automation),
				sources: {
					healthy: sourceRows.filter((item) => item.status?.success).length,
					total: sourceRows.length,
					configured_total: Object.keys(sourceSnapshot.sources || {}).length,
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

	async #testSource(name) {
		let result;
		switch (name) {
			case "wallex":
			case "tabdeal":
			case "exir": {
				const method = `check${name[0].toUpperCase()}${name.slice(1)}`;
				result = await this.s.sources[method]();
				await this.s.statuses.save(name, result);
				break;
			}
			case "wallgold":
				result = await this.s.sources.checkWallGold();
				break;
			case "coingecko": {
				const probe = await this.s.coinGecko.fetchTopAssets();
				result = probe.success
					? { success: true, status: probe.status, latency: probe.latency, message: null, price: null }
					: probe;
				await this.s.statuses.save("coingecko", result);
				break;
			}
			default:
				throw new Error(`Unknown source: ${name}`);
		}
		return { source: name, ...result };
	}

	async #refreshAssets() {
		const result = await this.s.coinGecko.fetchTopAssets();
		await this.s.statuses.save(
			"coingecko",
			result.success
				? { success: true, status: result.status, latency: result.latency, message: null, price: null }
				: result,
		);
		if (!result.success) throw new Error(result.message || "CoinGecko refresh failed");
		await this.s.assets.syncTopAssets(result.assets);
		const assets = await this.s.assets.all();
		return { assets, count: assets.length, enabled_count: assets.filter((item) => item.enabled).length };
	}
}
