import { COIN_NAMES_FA } from "../config/coins.js";

export function success(price = null, status = 200) {
	return { success: true, price, status, message: null };
}

export function failure(message, status = null, latency = null) {
	return {
		success: false,
		status,
		latency,
		message: String(message || "Unknown error"),
		price: null,
	};
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function capitalize(value) {
	return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

export function chunk(items, size) {
	const rows = [];
	for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
	return rows;
}

export function safeJson(value, fallback = null) {
	try {
		return value ? JSON.parse(value) : fallback;
	} catch {
		return fallback;
	}
}

export function nullableNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

export function parseBoolean(value, fallback = false) {
	if (value === undefined || value === null || value === "") return fallback;
	return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function normalizeTimestamp(value) {
	const number = Number(value || 0);
	return Number.isFinite(number) && number > 0 ? number : 0;
}

export function normalizeDigits(value) {
	return String(value)
		.replace(/[۰-۹]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
		.replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit));
}

export function pad2(value) {
	return String(Number(value)).padStart(2, "0");
}

export function validTime(value) {
	return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

export function timeToMinutes(value) {
	const [hour, minute] = String(value).split(":").map(Number);
	return hour * 60 + minute;
}

export function sourceLabel(source) {
	return ({
		wallex: "Wallex",
		tabdeal: "Tabdeal",
		exir: "Exir",
		bitpin: "Bitpin",
		nobitex: "Nobitex",
		coingecko: "CoinGecko",
		wallgold: "WallGold",
		technogold: "TechnoGold",
		melligold: "MelliGold",
		talasea: "Talasea",
		milli: "Milli",
		gerami: "Gerami",
	})[source] || source;
}

export function coinNameFa(id, fallback = "") {
	return COIN_NAMES_FA[id] || fallback || id;
}

export function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function errorMessage(error) {
	return error instanceof Error ? error.message : String(error || "Unknown error");
}
