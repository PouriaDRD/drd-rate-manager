export const API_AUDIENCES = Object.freeze({
	MARKET: "market",
	CORE: "core",
});

export const API_CATALOG = Object.freeze([
	Object.freeze({
		method: "GET",
		path: "/api/v1/market",
		audience: API_AUDIENCES.MARKET,
		summary: "Market snapshot",
		description:
			"Returns the shared cached market snapshot, including USDT/Toman, crypto, metals, data quality and cache metadata.",
	}),
	Object.freeze({
		method: "GET",
		path: "/api/v1/assets",
		audience: API_AUDIENCES.MARKET,
		summary: "Market assets",
		description:
			"Returns the cached asset configuration used by the market pipeline.",
	}),
	Object.freeze({
		method: "GET",
		path: "/api/v1/sources",
		audience: API_AUDIENCES.MARKET,
		summary: "Provider sources",
		description:
			"Returns cached provider/source status and the currently resolved USDT route.",
	}),
	Object.freeze({
		method: "GET",
		path: "/api/v1/sources/usdt",
		audience: API_AUDIENCES.MARKET,
		summary: "USDT source route",
		description:
			"Returns the cached USDT/Toman source resolution without forcing provider refreshes.",
	}),
	Object.freeze({
		method: "GET",
		path: "/api/v1/automation",
		audience: API_AUDIENCES.CORE,
		summary: "Automation state",
		description:
			"Returns the current publishing automation settings and scheduler state.",
	}),
	Object.freeze({
		method: "GET",
		path: "/api/v1/system",
		audience: API_AUDIENCES.CORE,
		summary: "System status",
		description:
			"Returns service, runtime, administrator and publishing automation status.",
	}),
	Object.freeze({
		method: "GET",
		path: "/api/v1/system/database",
		audience: API_AUDIENCES.CORE,
		summary: "Database diagnostics",
		description:
			"Returns the bounded D1 database diagnostic snapshot.",
	}),
]);

export const MARKET_API_PATHS = Object.freeze(
	API_CATALOG
		.filter((endpoint) => endpoint.audience === API_AUDIENCES.MARKET)
		.map((endpoint) => endpoint.path),
);

export const CORE_API_PATHS = Object.freeze(
	API_CATALOG
		.filter((endpoint) => endpoint.audience === API_AUDIENCES.CORE)
		.map((endpoint) => endpoint.path),
);

export function apiEndpoint(pathname) {
	return API_CATALOG.find((endpoint) => endpoint.path === pathname) || null;
}
