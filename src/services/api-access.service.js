export const MARKET_API_MODE_KEY = "market_api_mode";

export const MARKET_API_MODES = Object.freeze({
	PUBLIC: "public",
	PRIVATE: "private",
});

export const MARKET_API_PATHS = Object.freeze([
	"/api/v1/market",
	"/api/v1/assets",
	"/api/v1/sources",
	"/api/v1/sources/usdt",
]);

export const CORE_API_PATHS = Object.freeze([
	"/api/v1/automation",
	"/api/v1/system",
	"/api/v1/system/database",
]);

const MARKET_PATH_SET = new Set(MARKET_API_PATHS);
const CORE_PATH_SET = new Set(CORE_API_PATHS);

export function normalizeMarketApiMode(value, { missing = "public" } = {}) {
	if (value == null || String(value).trim() === "") return missing;
	const mode = String(value).trim().toLowerCase();
	if (mode === MARKET_API_MODES.PUBLIC || mode === MARKET_API_MODES.PRIVATE) {
		return mode;
	}
	return MARKET_API_MODES.PRIVATE;
}

export class ApiAccessService {
	constructor(settings, apiTokens) {
		this.settings = settings;
		this.apiTokens = apiTokens;
	}

	async marketMode() {
		const raw = await this.settings.get(MARKET_API_MODE_KEY, null);
		return normalizeMarketApiMode(raw);
	}

	async setMarketMode(mode) {
		const normalized = String(mode || "").trim().toLowerCase();
		if (
			normalized !== MARKET_API_MODES.PUBLIC &&
			normalized !== MARKET_API_MODES.PRIVATE
		) {
			throw new Error("Market API mode must be public or private.");
		}
		await this.settings.set(MARKET_API_MODE_KEY, normalized);
		return normalized;
	}

	async authorize(request, pathname) {
		if (MARKET_PATH_SET.has(pathname)) {
			const mode = await this.marketMode();
			if (mode === MARKET_API_MODES.PUBLIC) {
				return {
					ok: true,
					status: 200,
					reason: "public_market",
					requiredType: "market",
					mode,
					anonymous: true,
				};
			}
			const auth = await this.apiTokens.authenticate(request, "market");
			return {
				...auth,
				requiredType: "market",
				mode,
				anonymous: false,
			};
		}

		if (CORE_PATH_SET.has(pathname)) {
			const auth = await this.apiTokens.authenticate(request, "core");
			return {
				...auth,
				requiredType: "core",
				mode: "private",
				anonymous: false,
			};
		}

		return null;
	}
}
