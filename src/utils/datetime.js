import { escapeHtml, timeToMinutes } from "./core.js";

const dateTimeFormatterCache = new Map();

function getDateTimeFormatter(config, kind) {
	const key = `${config.timezone}:${kind}`;
	if (dateTimeFormatterCache.has(key)) return dateTimeFormatterCache.get(key);
	const options = kind === "time"
		? { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", hour12: false }
		: kind === "date"
			? { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }
			: { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
	const locale = kind === "date" || kind === "time" ? "fa-IR-u-ca-persian" : "en-CA";
	const formatter = new Intl.DateTimeFormat(locale, options);
	dateTimeFormatterCache.set(key, formatter);
	return formatter;
}

export function formatIranDate(config, timestamp) {
	return getDateTimeFormatter(config, "date").format(new Date(timestamp)).replace(/\//g, "/");
}

export function formatIranTime(config, timestamp) {
	return getDateTimeFormatter(config, "time").format(new Date(timestamp));
}

export function formatSystemDate(config, timestamp) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: config.timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(timestamp));
}

export function formatSystemTime(config, timestamp) {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone: config.timezone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(new Date(timestamp));
}

export function formatSystemDateTime(config, timestamp) {
	return `${formatSystemDate(config, timestamp)} · ${formatSystemTime(config, timestamp)}`;
}

export function formatOptionalSystemDateTime(config, timestamp) {
	return timestamp ? escapeHtml(formatSystemDateTime(config, timestamp)) : "نامشخص";
}

export function getCurrentMinutes(config, timestamp = Date.now()) {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: config.timezone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(new Date(timestamp));
	const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
	const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
	return hour * 60 + minute;
}

export function isInsideQuietHours(config, quietHours, timestamp = Date.now()) {
	const now = getCurrentMinutes(config, timestamp);
	const start = timeToMinutes(quietHours.start);
	const end = timeToMinutes(quietHours.end);
	if (start === end) return true;
	return start < end ? now >= start && now < end : now >= start || now < end;
}
