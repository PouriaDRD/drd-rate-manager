import { Application } from "./app/application.js";
import { runtimeIntegrity } from "./app/runtime-integrity.js";
import { jsonResponse } from "./http/responses.js";
import { OperationalLogger, withRequestId } from "./observability/operational-logger.js";
import { errorMessage } from "./utils/core.js";

if (!runtimeIntegrity()) throw new Error("Runtime integrity check failed");

const operations = new OperationalLogger();

export default {
	async fetch(request, env, ctx) {
		const operation = operations.beginHttp(request);
		operations.start(operation);
		try {
			const response = await new Application(env).fetch(request, ctx);
			operations.complete(operation, { status: response?.status ?? null });
			return withRequestId(response, operation.id);
		} catch (error) {
			operations.fail(operation, error);
			return withRequestId(
				jsonResponse(
					{ success: false, message: "Internal server error", error: errorMessage(error) },
					500,
				),
				operation.id,
			);
		}
	},

	async scheduled(controller, env, ctx) {
		const operation = operations.beginScheduled();
		operations.start(operation);
		try {
			const result = await new Application(env).scheduled(controller, ctx);
			operations.complete(operation);
			return result;
		} catch (error) {
			operations.fail(operation, error);
			throw error;
		}
	},
};
