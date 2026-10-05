import { APP } from "../config/app.js";

export function normalizePublishInterval(value) {
	const number = Number(value);
	return APP.publishIntervals.includes(number) ? number : APP.defaultPublishIntervalMinutes;
}

export function calculateNextPublishAt(automation) {
	if (!automation.enabled) return 0;
	const base = automation.lastRunAt || Date.now();
	return base + automation.intervalMinutes * 60 * 1000;
}
