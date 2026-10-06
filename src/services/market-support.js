import { resolveUsdtConsensus } from "../market/market-sources.js";

/** Resolve source checks through the production USDT consensus strategy. */
export function resolveUsdtChecks(checks) {
	return resolveUsdtConsensus(checks);
}
