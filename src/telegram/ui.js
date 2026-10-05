import { USDT_SOURCE_PRIORITY } from "../config/app.js";
import { escapeHtml, nullableNumber, sourceLabel } from "../utils/core.js";

export function resolveUsdtFromStatuses(statuses) {
	for (let index = 0; index < USDT_SOURCE_PRIORITY.length; index += 1) {
		const key = USDT_SOURCE_PRIORITY[index];
		const item = statuses[key];
		if (item?.success && nullableNumber(item.price) != null) {
			return {
				available: true,
				selected_source: sourceLabel(key),
				price_toman: nullableNumber(item.price),
				fallback_level: index,
				latency_ms: item.latency ?? null,
			};
		}
	}
	return {
		available: false,
		selected_source: null,
		price_toman: null,
		fallback_level: null,
		latency_ms: null,
	};
}

export function sourceStatusText(label, status, role = null) {
	const prefix = status?.success ? "🟢" : "🔴";
	const parts = [
		`${prefix} <b>${escapeHtml(label)}</b>${role ? ` · <code>${escapeHtml(role)}</code>` : ""}`,
	];
	if (status?.status != null) parts.push(`HTTP: <code>${status.status}</code>`);
	if (status?.latency != null) parts.push(`Latency: <code>${status.latency}ms</code>`);
	if (status?.message) parts.push(`<code>${escapeHtml(String(status.message).slice(0, 180))}</code>`);
	return parts.join("\n");
}

export function backKeyboard(label, callback) {
	return { inline_keyboard: [[{ text: `⬅️ ${label}`, callback_data: callback }]] };
}

export function normalizeCommand(text) {
	const first = String(text || "").trim().split(/\s+/)[0].toLowerCase();
	return first.replace(/@[^\s]+$/, "");
}
