import {
	serializeAutomation,
	serializeAutomationDiagnostics,
	serializeAutomationRun,
	serializeMarketSnapshot,
} from "../api/serializers.js";
import { APP } from "../config/app.js";
import { adminEmptyResponse, adminJsonResponse } from "../http/admin-responses.js";
import { WEB_LOGIN_RESULTS } from "../services/login-history.service.js";

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

const LOGIN_HISTORY_RESULTS = new Set(Object.values(WEB_LOGIN_RESULTS));

function queryInteger(searchParams, key, fallback, min, max) {
	const raw = searchParams.get(key);
	if (raw == null || raw === "") return fallback;
	if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer.`);
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error(`${key} must be between ${min} and ${max}.`);
	}
	return value;
}

function loginHistoryResult(searchParams) {
	const value = String(searchParams.get("result") || "all").trim().toLowerCase();
	if (!value || value === "all") return null;
	if (!LOGIN_HISTORY_RESULTS.has(value)) throw new Error("Invalid login history result filter.");
	return value;
}

function isoTimestamp(value) {
	const date = new Date(Number(value));
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function serializeLoginHistoryRecord(record) {
	return {
		id: Number(record.id),
		user_id: record.userId == null ? null : Number(record.userId),
		username: String(record.username || ""),
		result: String(record.result || ""),
		reason: String(record.reason || ""),
		ip_address: String(record.ipAddress || ""),
		user_agent: String(record.userAgent || ""),
		cf_ray: String(record.cfRay || ""),
		country: String(record.country || ""),
		region: String(record.region || ""),
		city: String(record.city || ""),
		timezone: String(record.timezone || ""),
		asn: record.asn == null ? null : Number(record.asn),
		session_ref: record.sessionRef == null ? null : String(record.sessionRef),
		created_at: isoTimestamp(record.createdAt),
	};
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
			if (request.method === "GET" && url.pathname === `${base}/api/v1/automation`) {
				return this.#automationState();
			}
			if (request.method === "PATCH" && url.pathname === `${base}/api/v1/automation/settings`) {
				const body = await readJson(request);
				const next = await this.s.automationManagement.updateSettings(body);
				await this.s.audit.add(String(auth.user.id), "web.automation.settings_updated", body);
				return adminJsonResponse({ success: true, data: this.#serializeAutomationState(next) });
			}
			if (request.method === "POST" && url.pathname === `${base}/api/v1/automation/dry-run`) {
				const body = await readJson(request);
				const result = await this.s.automationManagement.dryRun({
					actor: { type: "web", id: auth.user.id },
					refreshMarket: Boolean(body.refresh_market),
				});
				await this.s.audit.add(String(auth.user.id), "web.automation.dry_run", {
					refreshMarket: Boolean(body.refresh_market),
					partial: result.partial,
				});
				return adminJsonResponse({
					success: true,
					data: {
						mode: result.mode,
						partial: result.partial,
						generated_at: new Date(result.generatedAt).toISOString(),
						preview: {
							rich: result.rich,
							fallback_html: result.fallbackHtml,
						},
					},
				});
			}
			if (request.method === "POST" && url.pathname === `${base}/api/v1/automation/force-run`) {
				const body = await readJson(request);
				const result = await this.s.automationManagement.forceRun({
					actor: { type: "web", id: auth.user.id },
					refreshMarket: Boolean(body.refresh_market),
				});
				await this.s.audit.add(String(auth.user.id), "web.automation.force_run", {
					refreshMarket: Boolean(body.refresh_market),
					messageId: result.messageId,
					partial: result.partial,
				});
				return adminJsonResponse({
					success: true,
					data: {
						mode: result.mode,
						message_id: result.messageId,
						partial: result.partial,
					},
				});
			}
			if (request.method === "GET" && url.pathname === `${base}/api/v1/automation/history`) {
				const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
				const history = await this.s.automationManagement.history(limit);
				return adminJsonResponse({
					success: true,
					data: history.map(serializeAutomationRun),
				});
			}
			if (request.method === "GET" && url.pathname === `${base}/api/v1/login-history`) {
				const limit = queryInteger(url.searchParams, "limit", 25, 1, 100);
				const offset = queryInteger(url.searchParams, "offset", 0, 0, 100_000);
				const result = loginHistoryResult(url.searchParams);
				const [history, stats] = await Promise.all([
					this.s.loginHistory.list({ limit, offset, result }),
					this.s.loginHistory.stats(),
				]);
				const total = result ? Number(stats[result] || 0) : Number(stats.total || 0);
				return adminJsonResponse({
					success: true,
					data: {
						items: history.map(serializeLoginHistoryRecord),
						stats: {
							total: Number(stats.total || 0),
							success: Number(stats.success || 0),
							failure: Number(stats.failure || 0),
							locked: Number(stats.locked || 0),
						},
						pagination: {
							limit,
							offset,
							total,
							has_more: offset + history.length < total,
						},
						filter: { result: result || "all" },
					},
				});
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

	async #automationState() {
		const state = await this.s.automationManagement.state();
		return adminJsonResponse({ success: true, data: this.#serializeAutomationState(state) });
	}

	#serializeAutomationState(state) {
		return {
			bot_enabled: state.botEnabled,
			settings: serializeAutomation(this.s.config, state.settings),
			diagnostics: serializeAutomationDiagnostics(this.s.config, state.diagnostics),
			history: state.history.map(serializeAutomationRun),
			interval_options: APP.publishIntervals,
		};
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
			case "exir":
			case "bitpin":
			case "nobitex": {
				const method = `check${name[0].toUpperCase()}${name.slice(1)}`;
				result = await this.s.sources[method]();
				await this.s.statuses.save(name, result);
				break;
			}
			case "wallgold":
				result = await this.s.sources.checkWallGold();
				break;
			case "technogold":
				result = await this.s.sources.checkTechnoGold();
				break;
			case "melligold":
				result = await this.s.sources.checkMelliGold();
				break;
			case "talasea":
				result = await this.s.sources.checkTalasea();
				break;
			case "milli":
				result = await this.s.sources.checkMilli();
				break;
			case "gerami":
				result = await this.s.sources.checkGerami();
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
