import { ApiController } from "../controllers/api.controller.js";
import { TelegramController } from "../controllers/telegram.controller.js";
import { WebAdminAdminsController } from "../controllers/web-admin-admins.controller.js";
import { WebAdminApiManagementController } from "../controllers/web-admin-api-management.controller.js";
import { WebAdminAuthController } from "../controllers/web-admin-auth.controller.js";
import { WebAdminDataController } from "../controllers/web-admin-data.controller.js";
import { WebAdminSystemController } from "../controllers/web-admin-system.controller.js";
import { WebAdminUiController } from "../controllers/web-admin-ui.controller.js";
import { Database } from "../database/database.js";
import { jsonResponse } from "../http/responses.js";
import { errorMessage } from "../utils/core.js";
import { createServices } from "./container.js";

/** Application-level request and scheduled-event coordinator. */
export class Application {
	constructor(env) {
		this.env = env;
		this.database = new Database(env);
		this.services = createServices(env);
		this.api = new ApiController(this.services);
		this.telegram = new TelegramController(this.services);
		this.webAdmin = new WebAdminAuthController(this.services);
		this.webAdminAdmins = new WebAdminAdminsController(this.services);
		this.webAdminApiManagement = new WebAdminApiManagementController(this.services);
		this.webAdminSystem = new WebAdminSystemController(this.services);
		this.webAdminData = new WebAdminDataController(this.services);
		this.webAdminUi = new WebAdminUiController(this.services);
	}

	async fetch(request) {
		await this.database.ensureReady();
		await this.services.secureSettingsService.refresh();
		await this.services.config.refresh();
		const url = new URL(request.url);
		if (url.pathname === "/" || url.pathname.startsWith("/api/")) {
			const apiResponse = await this.api.route(request, url);
			if (apiResponse) return apiResponse;
		}
		if (request.method === "POST" && url.pathname === "/telegram/webhook") {
			await this.services.preferences.refresh();
			return this.telegram.handleWebhook(request);
		}
		const webAdminUiResponse = await this.webAdminUi.route(request, url);
		if (webAdminUiResponse) return webAdminUiResponse;
		const webAdminAdminsResponse = await this.webAdminAdmins.route(request, url);
		if (webAdminAdminsResponse) return webAdminAdminsResponse;
		const webAdminApiManagementResponse = await this.webAdminApiManagement.route(request, url);
		if (webAdminApiManagementResponse) return webAdminApiManagementResponse;
		const webAdminSystemResponse = await this.webAdminSystem.route(request, url);
		if (webAdminSystemResponse) return webAdminSystemResponse;
		const webAdminDataResponse = await this.webAdminData.route(request, url);
		if (webAdminDataResponse) return webAdminDataResponse;
		const webAdminResponse = await this.webAdmin.route(request, url);
		if (webAdminResponse) return webAdminResponse;
		return jsonResponse({ success: false, message: "Not found" }, 404);
	}

	async scheduled() {
		await this.services.secureSettingsService.refresh({ tolerateMissingTable: true });
		await this.services.config.refresh({ tolerateMissingTable: true });
		let result;
		try {
			result = await this.services.automation.tick();
		} catch (error) {
			await this.#evaluateOperationalAlerts();
			throw error;
		}
		await this.#evaluateOperationalAlerts();
		return result;
	}

	async #evaluateOperationalAlerts() {
		try {
			await this.services.preferences.refresh();
			const snapshot = await this.services.systemManagement.healthSnapshot();
			return await this.services.operationalAlerts.evaluate(snapshot);
		} catch (error) {
			console.warn({
				timestamp: new Date().toISOString(),
				level: "warn",
				event: "operational_alert.check_failed",
				message: errorMessage(error),
			});
			return null;
		}
	}
}
