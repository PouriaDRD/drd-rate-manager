import { CoinGeckoClient } from "../clients/coingecko.client.js";
import { HttpClient } from "../clients/http.client.js";
import { TelegramClient } from "../clients/telegram.client.js";
import { Config } from "../config/config.js";
import { createRuntimeEnv } from "../config/runtime-env.js";
import { SecretCrypto } from "../crypto/secret-crypto.js";
import { MarketPostBuilder } from "../market/market-post.builder.js";
import { MarketSources } from "../market/market-sources.js";
import { AdminInputRepository } from "../repositories/admin-input.repository.js";
import { AdminRepository } from "../repositories/admin.repository.js";
import { AssetRepository } from "../repositories/asset.repository.js";
import { AuditRepository } from "../repositories/audit.repository.js";
import { ApiTokenRepository } from "../repositories/api-token.repository.js";
import { AutomationRunRepository } from "../repositories/automation-run.repository.js";
import { LockRepository } from "../repositories/lock.repository.js";
import { MarketCacheRepository } from "../repositories/market-cache.repository.js";
import { OperationalAlertRepository } from "../repositories/operational-alert.repository.js";
import { RequiredMembershipRepository } from "../repositories/required-membership.repository.js";
import { SecureSettingsRepository } from "../repositories/secure-settings.repository.js";
import { SettingsRepository } from "../repositories/settings.repository.js";
import { SourceStatusRepository } from "../repositories/source-status.repository.js";
import { WebAdminRepository } from "../repositories/web-admin.repository.js";
import { WebAuthAttemptRepository } from "../repositories/web-auth-attempt.repository.js";
import { WebLoginHistoryRepository } from "../repositories/web-login-history.repository.js";
import { WebSessionRepository } from "../repositories/web-session.repository.js";
import { AdminManagementService } from "../services/admin-management.service.js";
import { ApiAccessService } from "../services/api-access.service.js";
import { ApiManagementService } from "../services/api-management.service.js";
import { AutomationManagementService } from "../services/automation-management.service.js";
import { AutomationService } from "../services/automation.service.js";
import { ApiTokenService } from "../services/api-token.service.js";
import { LoginHistoryService } from "../services/login-history.service.js";
import { MarketPublisher } from "../services/market-publisher.service.js";
import { MarketService } from "../services/market.service.js";
import { OperationalAlertService } from "../services/operational-alert.service.js";
import { PreferencesService } from "../services/preferences.service.js";
import { ProviderHealthService } from "../services/provider-health.service.js";
import { ProviderResilienceService } from "../services/provider-resilience.service.js";
import { RequiredMembershipService } from "../services/required-membership.service.js";
import { SecureSettingsService } from "../services/secure-settings.service.js";
import { SettingsService } from "../services/settings.service.js";
import { SourceSettingsService } from "../services/source-settings.service.js";
import { SystemManagementService } from "../services/system-management.service.js";
import { WebAuthService } from "../services/web-auth.service.js";
import { WebLoginAlertService } from "../services/web-login-alert.service.js";

/** Dependency composition root. */
export function createServices(env) {
	const secureSettings = new SecureSettingsRepository(env);
	const secretCrypto = new SecretCrypto(env.APP_MASTER_KEY);
	const secureSettingsService = new SecureSettingsService(env, secureSettings, secretCrypto);
	const runtimeEnv = createRuntimeEnv(env, secureSettingsService);

	const settings = new SettingsRepository(runtimeEnv);
	const requiredMembershipRepository = new RequiredMembershipRepository(settings);
	const settingsService = new SettingsService(runtimeEnv, settings);
	const preferences = new PreferencesService(settings);
	const operationalAlertRepository = new OperationalAlertRepository(settings);
	const config = new Config(runtimeEnv, settingsService);
	const cache = new MarketCacheRepository(runtimeEnv);
	const locks = new LockRepository(runtimeEnv);
	const resilience = new ProviderResilienceService(locks);
	const automationRuns = new AutomationRunRepository(runtimeEnv);
	const statuses = new SourceStatusRepository(runtimeEnv);
	const sourceSettings = new SourceSettingsService(settings, statuses);
	const providerHealth = new ProviderHealthService(sourceSettings, resilience);
	const assets = new AssetRepository(runtimeEnv, config);
	const admins = new AdminRepository(runtimeEnv, config);
	const adminInput = new AdminInputRepository(runtimeEnv);
	const audit = new AuditRepository(runtimeEnv);
	const apiTokenRepository = new ApiTokenRepository(runtimeEnv);
	const apiTokens = new ApiTokenService(apiTokenRepository);
	const apiAccess = new ApiAccessService(settings, apiTokens);
	const apiManagement = new ApiManagementService(apiTokens, apiAccess, audit);
	const adminManagement = new AdminManagementService(config, admins, audit);
	const webAdmins = new WebAdminRepository(runtimeEnv);
	const webSessions = new WebSessionRepository(runtimeEnv);
	const webAuthAttempts = new WebAuthAttemptRepository(runtimeEnv);
	const webLoginHistoryRepository = new WebLoginHistoryRepository(runtimeEnv);
	const loginHistory = new LoginHistoryService(webLoginHistoryRepository);
	const webAuth = new WebAuthService(runtimeEnv, webAdmins, webSessions, webAuthAttempts, undefined, loginHistory);
	const http = new HttpClient();
	const coinGecko = new CoinGeckoClient(runtimeEnv, config, http, resilience);
	const sources = new MarketSources(runtimeEnv, http, statuses, config, sourceSettings, resilience);
	const market = new MarketService(runtimeEnv, config, settings, cache, locks, assets, statuses, sources, coinGecko, sourceSettings);
	const telegram = new TelegramClient(runtimeEnv, http);
	const requiredMembership = new RequiredMembershipService(
		requiredMembershipRepository,
		telegram,
		audit,
	);
	const webLoginAlerts = new WebLoginAlertService(config, telegram, preferences);
	const postBuilder = new MarketPostBuilder(config);
	const publisher = new MarketPublisher(config, telegram, postBuilder);
	const automation = new AutomationService(runtimeEnv, config, settings, market, publisher, locks, automationRuns);
	const automationManagement = new AutomationManagementService(
		config,
		settings,
		automation,
		market,
		publisher,
		postBuilder,
		locks,
		automationRuns,
	);
	const systemManagement = new SystemManagementService({
		env: runtimeEnv,
		config,
		settings,
		requiredMembershipRepository,
		settingsService,
		secureSettingsService,
		cache,
		sourceSettings,
		providerHealth,
		operationalAlertRepository,
		automationRuns,
		automationManagement,
		adminManagement,
	});
	const operationalAlerts = new OperationalAlertService(
		config,
		telegram,
		preferences,
		operationalAlertRepository,
	);

	return {
		env: runtimeEnv,
		rawEnv: env,
		config,
		settings,
		settingsService,
		preferences,
		operationalAlertRepository,
		secureSettings,
		secureSettingsService,
		secretCrypto,
		cache,
		locks,
		resilience,
		automationRuns,
		statuses,
		sourceSettings,
		providerHealth,
		assets,
		admins,
		adminInput,
		audit,
		apiTokenRepository,
		apiTokens,
		apiAccess,
		apiManagement,
		adminManagement,
		webAdmins,
		webSessions,
		webAuthAttempts,
		webLoginHistoryRepository,
		loginHistory,
		webAuth,
		http,
		coinGecko,
		sources,
		market,
		telegram,
		requiredMembership,
		webLoginAlerts,
		postBuilder,
		publisher,
		automation,
		automationManagement,
		operationalAlerts,
		systemManagement,
	};
}
