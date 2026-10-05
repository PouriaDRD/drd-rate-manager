import { Application } from "./app/application.js";
import { runtimeIntegrity } from "./app/runtime-integrity.js";
import { jsonResponse } from "./http/responses.js";
import { errorMessage } from "./utils/core.js";

if (!runtimeIntegrity()) throw new Error("Runtime integrity check failed");

export default {
	async fetch(request, env, ctx) {
		try {
			return await new Application(env).fetch(request, ctx);
		} catch (error) {
			console.error("http.unhandled_error", {
				message: errorMessage(error),
				stack: error?.stack || null,
			});
			return jsonResponse(
				{ success: false, message: "Internal server error", error: errorMessage(error) },
				500,
			);
		}
	},

	async scheduled(controller, env, ctx) {
		try {
			await new Application(env).scheduled(controller, ctx);
		} catch (error) {
			console.error("cron.unhandled_error", {
				message: errorMessage(error),
				stack: error?.stack || null,
			});
			throw error;
		}
	},
};
