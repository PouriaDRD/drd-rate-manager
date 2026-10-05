import { ApiController } from "../controllers/api.controller.js";
import { TelegramController } from "../controllers/telegram.controller.js";
import { WebAdminAuthController } from "../controllers/web-admin-auth.controller.js";
import { WebAdminDataController } from "../controllers/web-admin-data.controller.js";
import { WebAdminUiController } from "../controllers/web-admin-ui.controller.js";
import { Database } from "../database/database.js";
import { jsonResponse } from "../http/responses.js";
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
		const webAdminDataResponse = await this.webAdminData.route(request, url);
		if (webAdminDataResponse) return webAdminDataResponse;
		const webAdminResponse = await this.webAdmin.route(request, url);
		if (webAdminResponse) return webAdminResponse;
		return jsonResponse({ success: false, message: "Not found" }, 404);
	}

	async scheduled() {
		await this.services.secureSettingsService.refresh({ tolerateMissingTable: true });
		await this.services.config.refresh({ tolerateMissingTable: true });
		return this.services.automation.tick();
	}
}
