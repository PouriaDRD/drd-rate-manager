import { ApiController } from "../controllers/api.controller.js";
import { TelegramController } from "../controllers/telegram.controller.js";
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
	}

	async fetch(request) {
		await this.database.ensureReady();
		const url = new URL(request.url);
		const apiResponse = await this.api.route(request, url);
		if (apiResponse) return apiResponse;
		if (request.method === "POST" && url.pathname === "/telegram/webhook") {
			return this.telegram.handleWebhook(request);
		}
		return jsonResponse({ success: false, message: "Not found" }, 404);
	}

	async scheduled() {
		// Deliberately do not run schema bootstrap/migrations on every minute Cron.
		return this.services.automation.tick();
	}
}
