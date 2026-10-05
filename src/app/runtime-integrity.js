import { CoinGeckoClient } from "../clients/coingecko.client.js";
import { TelegramClient } from "../clients/telegram.client.js";
import { MarketPostBuilder } from "../market/market-post.builder.js";
import { AutomationService } from "../services/automation.service.js";
import { MarketService } from "../services/market.service.js";

export function runtimeIntegrity() {
	const contracts = [
		[MarketPostBuilder.prototype, "buildRichMessage"],
		[MarketService.prototype, "getSnapshot"],
		[CoinGeckoClient.prototype, "fetchMarketBundle"],
		[TelegramClient.prototype, "sendRichMessage"],
		[AutomationService.prototype, "tick"],
	];
	return contracts.every(([target, method]) => typeof target?.[method] === "function");
}
