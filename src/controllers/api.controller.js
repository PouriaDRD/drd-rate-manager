import { APP } from "../config/app.js";
import { serializeAutomation, serializeMarketSnapshot } from "../api/serializers.js";
import { runtimeIntegrity } from "../app/runtime-integrity.js";
import { corsResponse, jsonResponse } from "../http/responses.js";
import { databaseStatus } from "../system/database-status.js";
import { resolveUsdtFromStatuses } from "../telegram/ui.js";
import { parseBoolean } from "../utils/core.js";

function accessErrorResponse(access) {
	const status = Number(access?.status || 401);
	return jsonResponse(
		{
			success: false,
			message: status === 403 ? "Forbidden" : "Unauthorized",
			error: {
				code: access?.reason || "unauthorized",
				required_scope: access?.requiredType || null,
			},
		},
		status,
	);
}

/** HTTP API controller. */
export class ApiController {
	constructor(services) {
		this.s = services;
	}

	async route(request, url) {
		if (request.method === "OPTIONS") return corsResponse();
		if (request.method !== "GET") return null;

		const access = url.pathname === "/" ? null : await this.s.apiAccess.authorize(request, url.pathname);
		if (access && !access.ok) return accessErrorResponse(access);

		switch (url.pathname) {
			case "/":
				return jsonResponse({
					success: true,
					service: this.s.config.env.APP_NAME || APP.name,
					version: this.s.config.version,
					api_version: APP.apiVersion,
					endpoints: {
						market: "/api/v1/market",
						assets: "/api/v1/assets",
						sources: "/api/v1/sources",
						usdt: "/api/v1/sources/usdt",
						automation: "/api/v1/automation",
						system: "/api/v1/system",
						database: "/api/v1/system/database",
						docs: "/docs",
						openapi: "/openapi.json",
					},
				});

			case "/api/v1/market": {
				const snapshot = await this.s.market.getSnapshot();
				return jsonResponse({ success: true, data: serializeMarketSnapshot(this.s.config, snapshot) });
			}

			case "/api/v1/assets": {
				const assets = await this.s.assets.all();
				return jsonResponse({
					success: true,
					data: {
						cached: true,
						count: assets.length,
						enabled_count: assets.filter((item) => item.enabled).length,
						assets,
					},
				});
			}

			case "/api/v1/sources": {
				const sources = await this.s.statuses.all();
				return jsonResponse({
					success: true,
					data: { cached: true, sources, usdt: resolveUsdtFromStatuses(sources) },
				});
			}

			case "/api/v1/sources/usdt": {
				const sources = await this.s.statuses.all();
				return jsonResponse({ success: true, data: resolveUsdtFromStatuses(sources) });
			}

			case "/api/v1/automation": {
				const automation = await this.s.automation.getSettings();
				return jsonResponse({
					success: true,
					data: serializeAutomation(this.s.config, automation),
				});
			}

			case "/api/v1/system": {
				const [enabled, adminStats, automation] = await Promise.all([
					this.s.settings.get("bot_enabled", "1"),
					this.s.admins.stats(),
					this.s.automation.getSettings(),
				]);
				return jsonResponse({
					success: true,
					data: {
						service: APP.name,
						version: this.s.config.version,
						api_version: APP.apiVersion,
						timezone: this.s.config.timezone,
						enabled: parseBoolean(enabled, true),
						integrity: runtimeIntegrity(),
						admins: adminStats,
						automation: {
							enabled: automation.enabled,
							interval_minutes: automation.intervalMinutes,
							quiet_hours_enabled: automation.quietHours.enabled,
						},
					},
				});
			}

			case "/api/v1/system/database":
				return jsonResponse({ success: true, data: await databaseStatus(this.s) });

			default:
				return null;
		}
	}
}
