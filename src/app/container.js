import { CoinGeckoClient } from "../clients/coingecko.client.js";
import { HttpClient } from "../clients/http.client.js";
import { TelegramClient } from "../clients/telegram.client.js";
import { Config } from "../config/config.js";
import { MarketPostBuilder } from "../market/market-post.builder.js";
import { MarketSources } from "../market/market-sources.js";
import { AdminInputRepository } from "../repositories/admin-input.repository.js";
import { AdminRepository } from "../repositories/admin.repository.js";
import { AssetRepository } from "../repositories/asset.repository.js";
import { AuditRepository } from "../repositories/audit.repository.js";
import { LockRepository } from "../repositories/lock.repository.js";
import { MarketCacheRepository } from "../repositories/market-cache.repository.js";
import { SettingsRepository } from "../repositories/settings.repository.js";
import { SourceStatusRepository } from "../repositories/source-status.repository.js";
import { AutomationService } from "../services/automation.service.js";
import { MarketPublisher } from "../services/market-publisher.service.js";
import { MarketService } from "../services/market.service.js";

/** Dependency composition root. */
export function createServices(env) {
	const config = new Config(env);
	const settings = new SettingsRepository(env);
	const cache = new MarketCacheRepository(env);
	const locks = new LockRepository(env);
	const statuses = new SourceStatusRepository(env);
	const assets = new AssetRepository(env, config);
	const admins = new AdminRepository(env, config);
	const adminInput = new AdminInputRepository(env);
	const audit = new AuditRepository(env);
	const http = new HttpClient();
	const coinGecko = new CoinGeckoClient(env, config, http);
	const sources = new MarketSources(env, http, statuses);
	const market = new MarketService(
		env,
		config,
		settings,
		cache,
		locks,
		assets,
		statuses,
		sources,
		coinGecko,
	);
	const telegram = new TelegramClient(env, http);
	const postBuilder = new MarketPostBuilder(config);
	const publisher = new MarketPublisher(config, telegram, postBuilder);
	const automation = new AutomationService(env, config, settings, market, publisher, locks);

	return {
		env,
		config,
		settings,
		cache,
		locks,
		statuses,
		assets,
		admins,
		adminInput,
		audit,
		http,
		coinGecko,
		sources,
		market,
		telegram,
		postBuilder,
		publisher,
		automation,
	};
}
