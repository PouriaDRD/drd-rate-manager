import { API_AUDIENCES, API_CATALOG } from "./catalog.js";

const COMMON_ERROR_SCHEMA = Object.freeze({
	type: "object",
	required: ["success", "message", "error"],
	properties: {
		success: { type: "boolean", const: false },
		message: { type: "string" },
		error: {
			type: "object",
			required: ["code", "required_scope"],
			properties: {
				code: { type: "string" },
				required_scope: {
					oneOf: [{ type: "string" }, { type: "null" }],
				},
			},
		},
	},
});

function securityFor(endpoint, marketMode) {
	if (endpoint.audience === API_AUDIENCES.CORE) {
		return [{ CoreToken: [] }];
	}
	return marketMode === "private" ? [{ MarketToken: [] }] : [];
}

function authDescription(endpoint, marketMode) {
	if (endpoint.audience === API_AUDIENCES.CORE) {
		return "Always private. Requires a valid Core API token (`drd_core_*`) in the Bearer Authorization header.";
	}
	if (marketMode === "private") {
		return "Market API is currently PRIVATE. Requires a valid Market API token (`drd_mkt_*`) in the Bearer Authorization header.";
	}
	return "Market API is currently PUBLIC. Authentication is not required.";
}

function responseSchema(endpoint) {
	switch (endpoint.path) {
		case "/api/v1/market":
			return {
				type: "object",
				required: ["success", "data"],
				properties: {
					success: { type: "boolean", const: true },
					data: {
						type: "object",
						description:
							"Serialized market snapshot. Fields include timestamps, USDT/Toman, crypto, metals, quality and cache metadata.",
						additionalProperties: true,
					},
				},
			};
		case "/api/v1/assets":
			return {
				type: "object",
				required: ["success", "data"],
				properties: {
					success: { type: "boolean", const: true },
					data: {
						type: "object",
						required: ["cached", "count", "enabled_count", "assets"],
						properties: {
							cached: { type: "boolean" },
							count: { type: "integer", minimum: 0 },
							enabled_count: { type: "integer", minimum: 0 },
							assets: {
								type: "array",
								items: { type: "object", additionalProperties: true },
							},
						},
					},
				},
			};
		default:
			return {
				type: "object",
				required: ["success", "data"],
				properties: {
					success: { type: "boolean", const: true },
					data: { type: "object", additionalProperties: true },
				},
			};
	}
}

export function buildOpenApiDocument({
	origin,
	version,
	marketMode,
	apiVersion = "v1",
}) {
	const paths = {};
	for (const endpoint of API_CATALOG) {
		const protectedEndpoint =
			endpoint.audience === API_AUDIENCES.CORE || marketMode === "private";
		paths[endpoint.path] = {
			get: {
				tags: [endpoint.audience === API_AUDIENCES.CORE ? "Core" : "Market"],
				summary: endpoint.summary,
				description: `${endpoint.description}\n\n${authDescription(endpoint, marketMode)}`,
				operationId: endpoint.path
					.replace(/^\/api\/v1\//, "")
					.replaceAll("/", "_")
					.replaceAll("-", "_"),
				security: securityFor(endpoint, marketMode),
				responses: {
					"200": {
						description: "Successful response",
						content: {
							"application/json": {
								schema: responseSchema(endpoint),
							},
						},
					},
					...(protectedEndpoint
						? {
								"401": {
									description: "Missing, invalid, disabled, revoked or expired API token.",
									content: {
										"application/json": {
											schema: { $ref: "#/components/schemas/ApiError" },
										},
									},
								},
								"403": {
									description:
										"A valid token was provided for the wrong isolated API scope.",
									content: {
										"application/json": {
											schema: { $ref: "#/components/schemas/ApiError" },
										},
									},
								},
							}
						: {}),
				},
			},
		};
	}

	return {
		openapi: "3.1.0",
		info: {
			title: "DRD RATE MANAGER API",
			version,
			description:
				"External integration API. Market and Core credentials are intentionally isolated and cannot be used across scopes.",
		},
		servers: [{ url: origin }],
		tags: [
			{
				name: "Market",
				description:
					`Market data endpoints. Current access mode: ${marketMode.toUpperCase()}.`,
			},
			{
				name: "Core",
				description:
					"Operational endpoints that always require a Core API token.",
			},
		],
		paths,
		components: {
			securitySchemes: {
				MarketToken: {
					type: "http",
					scheme: "bearer",
					bearerFormat: "drd_mkt_*",
					description:
						"Market-scoped API token. Cannot authenticate Core endpoints.",
				},
				CoreToken: {
					type: "http",
					scheme: "bearer",
					bearerFormat: "drd_core_*",
					description:
						"Core-scoped API token. Cannot authenticate Market endpoints.",
				},
			},
			schemas: {
				ApiError: COMMON_ERROR_SCHEMA,
			},
		},
		"x-drd": {
			api_version: apiVersion,
			market_mode: marketMode,
			scope_isolation: true,
			docs: "/docs",
		},
	};
}
