import { GOLD_SOURCE_NAMES } from "../config/app.js";

const SOURCE_DEFINITIONS = Object.freeze({
	wallex: Object.freeze({ key: "source.wallex.enabled", label: "Wallex", kind: "usdt", defaultEnabled: true }),
	tabdeal: Object.freeze({ key: "source.tabdeal.enabled", label: "Tabdeal", kind: "usdt", defaultEnabled: true }),
	exir: Object.freeze({ key: "source.exir.enabled", label: "Exir", kind: "usdt", defaultEnabled: true }),
	bitpin: Object.freeze({ key: "source.bitpin.enabled", label: "Bitpin", kind: "usdt", defaultEnabled: true }),
	nobitex: Object.freeze({ key: "source.nobitex.enabled", label: "Nobitex", kind: "usdt", defaultEnabled: false }),
	ompfinex: Object.freeze({ key: "source.ompfinex.enabled", label: "OMPFinex", kind: "usdt", defaultEnabled: true }),
	ramzinex: Object.freeze({ key: "source.ramzinex.enabled", label: "Ramzinex", kind: "usdt", defaultEnabled: true }),
	coingecko: Object.freeze({ key: "source.coingecko.enabled", label: "CoinGecko", kind: "market", defaultEnabled: true }),
	wallgold: Object.freeze({ key: "source.wallgold.enabled", label: "WallGold", kind: "gold", defaultEnabled: true }),
	technogold: Object.freeze({ key: "source.technogold.enabled", label: "TechnoGold", kind: "gold", defaultEnabled: true }),
	melligold: Object.freeze({ key: "source.melligold.enabled", label: "MelliGold", kind: "gold", defaultEnabled: false }),
	talasea: Object.freeze({ key: "source.talasea.enabled", label: "Talasea", kind: "gold", defaultEnabled: true }),
	milli: Object.freeze({ key: "source.milli.enabled", label: "Milli", kind: "gold", defaultEnabled: true }),
	gerami: Object.freeze({ key: "source.gerami.enabled", label: "Gerami", kind: "gold", defaultEnabled: true }),
});

export const SOURCE_NAMES = Object.freeze(Object.keys(SOURCE_DEFINITIONS));
export const USDT_SOURCE_NAMES = Object.freeze(["wallex", "tabdeal", "exir", "bitpin", "nobitex", "ompfinex", "ramzinex"]);
export const DEFAULT_USDT_PRIORITY = Object.freeze([...USDT_SOURCE_NAMES]);
export { GOLD_SOURCE_NAMES };
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
				enabled: parseEnabled(values[definition.key], definition.defaultEnabled),
				priority: priority.includes(name) ? priority.indexOf(name) : null,
				status: statuses[name] || null,
			};
		}
		return { sources, usdt_priority: priority, usdt_strategy: "consensus" };
	}

	async isEnabled(name) {
		const definition = this.#definition(name);
		const fallback = definition.defaultEnabled ? "1" : "0";
		return parseEnabled(
			await this.settings.get(definition.key, fallback),
			definition.defaultEnabled,
		);
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
		const requested = Array.isArray(priority)
			? priority.map((item) => String(item).trim().toLowerCase())
			: [];
		if (
			requested.length !== USDT_SOURCE_NAMES.length ||
			new Set(requested).size !== USDT_SOURCE_NAMES.length ||
			!USDT_SOURCE_NAMES.every((source) => requested.includes(source)) ||
			requested.some((item, index) => item !== normalized[index])
		) {
			throw new Error(
				"USDT source order must contain wallex, tabdeal, exir, bitpin, nobitex, ompfinex and ramzinex exactly once.",
			);
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
