export const MARKET_CORE_SECTIONS = Object.freeze([
	"usdt",
	"crypto",
	"iran_gold",
]);

export const MARKET_AUXILIARY_SECTIONS = Object.freeze([
	"global_metals",
]);

export const MARKET_MIN_CORE_SECTIONS_FOR_PUBLISH = 2;

function hasValue(value) {
	if (value === null || value === undefined || value === "") return false;
	return Number.isFinite(Number(value));
}

export function analyzeMarketSnapshot(snapshot = {}) {
	const sections = {
		usdt: hasValue(snapshot.usdt?.price),
		crypto: (snapshot.crypto || []).some((item) => hasValue(item?.price)),
		iran_gold: hasValue(snapshot.metals?.gram18),
		global_metals:
			hasValue(snapshot.metals?.gold) ||
			hasValue(snapshot.metals?.silver),
	};

	const availableSections = Object.entries(sections)
		.filter(([, available]) => available)
		.map(([name]) => name);
	const missingSections = Object.entries(sections)
		.filter(([, available]) => !available)
		.map(([name]) => name);
	const coreAvailable = MARKET_CORE_SECTIONS.filter((name) => sections[name]).length;
	const totalSections = MARKET_CORE_SECTIONS.length + MARKET_AUXILIARY_SECTIONS.length;
	const completeness = Math.round((availableSections.length / totalSections) * 100);

	return {
		publishable: coreAvailable >= MARKET_MIN_CORE_SECTIONS_FOR_PUBLISH,
		coreAvailable,
		coreRequired: MARKET_MIN_CORE_SECTIONS_FOR_PUBLISH,
		coreTotal: MARKET_CORE_SECTIONS.length,
		completeness,
		sections,
		availableSections,
		missingSections,
	};
}

export function assertMarketPublishable(snapshot = {}) {
	const quality = analyzeMarketSnapshot(snapshot);
	if (quality.publishable) return quality;

	const error = new Error(
		`Market snapshot is not publishable: ${quality.coreAvailable}/${quality.coreTotal} core sections available; ${quality.coreRequired} required.`,
	);
	error.code = "MARKET_SNAPSHOT_NOT_PUBLISHABLE";
	error.quality = quality;
	throw error;
}
