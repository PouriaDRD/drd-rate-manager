const SOURCE_DEFINITIONS = Object.freeze({
	wallex: Object.freeze({ key: "source.wallex.enabled", label: "Wallex", kind: "usdt" }),
	tabdeal: Object.freeze({ key: "source.tabdeal.enabled", label: "Tabdeal", kind: "usdt" }),
	exir: Object.freeze({ key: "source.exir.enabled", label: "Exir", kind: "usdt" }),
	coingecko: Object.freeze({ key: "source.coingecko.enabled", label: "CoinGecko", kind: "market" }),
	wallgold: Object.freeze({ key: "source.wallgold.enabled", label: "WallGold", kind: "gold" }),
});

export const SOURCE_NAMES = Object.freeze(Object.keys(SOURCE_DEFINITIONS));
export const USDT_SOURCE_NAMES = Object.freeze(["wallex", "tabdeal", "exir"]);
export const DEFAULT_USDT_PRIORITY = Object.freeze([...USDT_SOURCE_NAMES]);
const PRIORITY_KEY = "usdt_source_priority";

function parseEnabled(value, fallback = true) {
	if (value === undefined || value === null || value === "") return fallback;
	return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}

export function normalizeUsdtPriority(value) {
	const list = Array.isArray(value)
		? value.map((item) => String(item).trim().toLowerCase())
		: String(value || "")
			.split(",")
			.map((item) => item.trim().toLowerCase())
			.filter(Boolean);
	const unique = [...new Set(list)];
	if (
		unique.length !== USDT_SOURCE_NAMES.length ||
		!USDT_SOURCE_NAMES.every((source) => unique.includes(source))
	) {
		return [...DEFAULT_USDT_PRIORITY];
	}
	return unique;
}

export class SourceSettingsService {
	constructor(settings, statuses) {
		this.settings = settings;
		this.statuses = statuses;
	}

	async snapshot() {
		const keys = [...SOURCE_NAMES.map((name) => SOURCE_DEFINITIONS[name].key), PRIORITY_KEY];
		const [values, statuses] = await Promise.all([
			this.settings.getMany(keys),
			this.statuses.all(),
		]);
		const priority = normalizeUsdtPriority(values[PRIORITY_KEY]);
		const sources = {};
		for (const name of SOURCE_NAMES) {
			const definition = SOURCE_DEFINITIONS[name];
			sources[name] = {
				name,
				label: definition.label,
				kind: definition.kind,
				enabled: parseEnabled(values[definition.key], true),
				priority: priority.includes(name) ? priority.indexOf(name) : null,
				status: statuses[name] || null,
			};
		}
		return { sources, usdt_priority: priority };
	}

	async isEnabled(name) {
		const definition = this.#definition(name);
		return parseEnabled(await this.settings.get(definition.key, "1"), true);
	}

	async setEnabled(name, enabled) {
		const definition = this.#definition(name);
		await this.settings.set(definition.key, enabled ? "1" : "0");
		return Boolean(enabled);
	}

	async usdtPriority() {
		return normalizeUsdtPriority(await this.settings.get(PRIORITY_KEY, DEFAULT_USDT_PRIORITY.join(",")));
	}

	async setUsdtPriority(priority) {
		const normalized = normalizeUsdtPriority(priority);
		const requested = Array.isArray(priority) ? priority.map((item) => String(item).trim().toLowerCase()) : [];
		if (requested.length !== 3 || requested.some((item, index) => item !== normalized[index])) {
			throw new Error("USDT priority must contain wallex, tabdeal and exir exactly once.");
		}
		await this.settings.set(PRIORITY_KEY, normalized.join(","));
		return normalized;
	}

	#definition(name) {
		const key = String(name || "").trim().toLowerCase();
		const definition = SOURCE_DEFINITIONS[key];
		if (!definition) throw new Error(`Unknown source: ${name}`);
		return definition;
	}
}
