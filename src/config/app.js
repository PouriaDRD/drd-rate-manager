export const APP = Object.freeze({
	name: "DRD RATE MANAGER",
	displayName: "DRD Rate Manager",
	version: "0.2.0",
	schemaVersion: 13,
	apiVersion: "v1",
	defaultCacheTtlSeconds: 30,
	defaultPublishIntervalMinutes: 10,
	cacheTtlOptions: [5, 10, 15, 30, 60, 120, 300, 600],
	publishIntervals: [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
	quietMinuteOptions: [0, 15, 30, 45],
	defaultQuietHours: Object.freeze({ enabled: false, start: "01:00", end: "10:30" }),
	adminInputTtlMs: 10 * 60 * 1000,
	marketCacheKey: "market_snapshot",
	marketRefreshLockKey: "market_refresh",
	marketRefreshLockMs: 15_000,
});

export const USDT_SOURCE_PRIORITY = Object.freeze(["wallex", "tabdeal", "exir", "bitpin", "nobitex"]);
export const GOLD_SOURCE_NAMES = Object.freeze(["wallgold", "technogold", "melligold", "talasea", "milli", "gerami"]);
