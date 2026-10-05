import { USDT_SOURCE_PRIORITY } from "../config/app.js";
import { failure, nullableNumber, sourceLabel } from "../utils/core.js";

/** Resolve a set of source checks using the production USDT priority order. */
export function resolveUsdtChecks(checks) {
	for (let index = 0; index < USDT_SOURCE_PRIORITY.length; index += 1) {
		const source = USDT_SOURCE_PRIORITY[index];
		const item = checks?.[source];
		if (item?.success && nullableNumber(item.price) != null) {
			return { ...item, source, sourceLabel: sourceLabel(source), fallbackLevel: index };
		}
	}
	return failure("All USDT sources failed");
}
