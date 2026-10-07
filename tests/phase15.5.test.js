import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	API_AUDIENCES,
	API_CATALOG,
	CORE_API_PATHS,
	MARKET_API_PATHS,
	apiEndpoint,
} from "../src/api/catalog.js";
import { buildOpenApiDocument } from "../src/api/openapi.js";
import { ApiDocsController } from "../src/controllers/api-docs.controller.js";
import {
	ApiAccessService,
	CORE_API_PATHS as ACCESS_CORE_PATHS,
	MARKET_API_PATHS as ACCESS_MARKET_PATHS,
} from "../src/services/api-access.service.js";

function services(mode = "public") {
	return {
		config: { version: "0.2.0" },
		apiAccess: {
			async marketMode() {
				return mode;
			},
		},
	};
}

test("API catalog is the single external v1 inventory with four Market and three Core endpoints", () => {
	assert.equal(API_CATALOG.length, 7);
	assert.equal(MARKET_API_PATHS.length, 4);
	assert.equal(CORE_API_PATHS.length, 3);
	assert.deepEqual(MARKET_API_PATHS, [
		"/api/v1/market",
		"/api/v1/assets",
		"/api/v1/sources",
		"/api/v1/sources/usdt",
	]);
	assert.deepEqual(CORE_API_PATHS, [
		"/api/v1/automation",
		"/api/v1/system",
		"/api/v1/system/database",
	]);
	assert.equal(new Set(API_CATALOG.map((item) => item.path)).size, API_CATALOG.length);
	assert.ok(API_CATALOG.every((item) => item.method === "GET"));
});

test("catalog lookup returns stable audience metadata without exposing Web Admin internals", () => {
	assert.equal(apiEndpoint("/api/v1/market")?.audience, API_AUDIENCES.MARKET);
	assert.equal(apiEndpoint("/api/v1/system")?.audience, API_AUDIENCES.CORE);
	assert.equal(apiEndpoint("/docs"), null);
	assert.equal(apiEndpoint("/admin/api/v1/system"), null);
	assert.equal(API_CATALOG.some((item) => item.path.includes("admin")), false);
});

test("ApiAccessService re-exports catalog paths for Phase 15.2 compatibility", () => {
	assert.deepEqual(ACCESS_MARKET_PATHS, MARKET_API_PATHS);
	assert.deepEqual(ACCESS_CORE_PATHS, CORE_API_PATHS);
});

test("ApiAccessService authorization is driven by catalog lookup rather than duplicated path sets", async () => {
	const source = await readFile(
		new URL("../src/services/api-access.service.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /apiEndpoint\(pathname\)/);
	assert.match(source, /API_AUDIENCES\.MARKET/);
	assert.doesNotMatch(source, /new Set\(MARKET_API_PATHS\)/);
	assert.doesNotMatch(source, /new Set\(CORE_API_PATHS\)/);
	assert.doesNotMatch(source, /"\/api\/v1\/market",/);
});

test("public Market mode requires no OpenAPI security while Core always requires CoreToken", () => {
	const document = buildOpenApiDocument({
		origin: "https://rates.example",
		version: "0.2.0",
		marketMode: "public",
	});
	assert.deepEqual(document.paths["/api/v1/market"].get.security, []);
	assert.deepEqual(document.paths["/api/v1/assets"].get.security, []);
	assert.deepEqual(
		document.paths["/api/v1/system"].get.security,
		[{ CoreToken: [] }],
	);
	assert.deepEqual(
		document.paths["/api/v1/automation"].get.security,
		[{ CoreToken: [] }],
	);
});

test("private Market mode requires only MarketToken and never CoreToken", () => {
	const document = buildOpenApiDocument({
		origin: "https://rates.example",
		version: "0.2.0",
		marketMode: "private",
	});
	for (const path of MARKET_API_PATHS) {
		assert.deepEqual(document.paths[path].get.security, [{ MarketToken: [] }]);
		assert.equal(
			JSON.stringify(document.paths[path].get.security).includes("CoreToken"),
			false,
		);
	}
	for (const path of CORE_API_PATHS) {
		assert.deepEqual(document.paths[path].get.security, [{ CoreToken: [] }]);
	}
});

test("OpenAPI 3.1 declares isolated Market/Core bearer schemes", () => {
	const document = buildOpenApiDocument({
		origin: "https://rates.example",
		version: "0.2.0",
		marketMode: "private",
	});
	assert.equal(document.openapi, "3.1.0");
	assert.equal(document.servers[0].url, "https://rates.example");
	assert.equal(
		document.components.securitySchemes.MarketToken.bearerFormat,
		"drd_mkt_*",
	);
	assert.equal(
		document.components.securitySchemes.CoreToken.bearerFormat,
		"drd_core_*",
	);
	assert.equal(document["x-drd"].scope_isolation, true);
	assert.equal(document["x-drd"].market_mode, "private");
});

test("OpenAPI paths exactly match the shared API catalog", () => {
	for (const mode of ["public", "private"]) {
		const document = buildOpenApiDocument({
			origin: "https://rates.example",
			version: "0.2.0",
			marketMode: mode,
		});
		assert.deepEqual(
			Object.keys(document.paths).sort(),
			API_CATALOG.map((item) => item.path).sort(),
		);
	}
});

test("protected OpenAPI operations document 401 and 403 while public Market operations do not lie", () => {
	const publicDocument = buildOpenApiDocument({
		origin: "https://rates.example",
		version: "0.2.0",
		marketMode: "public",
	});
	assert.equal(
		Object.hasOwn(publicDocument.paths["/api/v1/market"].get.responses, "401"),
		false,
	);
	assert.equal(
		Object.hasOwn(publicDocument.paths["/api/v1/market"].get.responses, "403"),
		false,
	);
	assert.ok(publicDocument.paths["/api/v1/system"].get.responses["401"]);
	assert.ok(publicDocument.paths["/api/v1/system"].get.responses["403"]);

	const privateDocument = buildOpenApiDocument({
		origin: "https://rates.example",
		version: "0.2.0",
		marketMode: "private",
	});
	assert.ok(privateDocument.paths["/api/v1/market"].get.responses["401"]);
	assert.ok(privateDocument.paths["/api/v1/market"].get.responses["403"]);
});

test("OpenAPI contains successful response contracts for every external endpoint", () => {
	const document = buildOpenApiDocument({
		origin: "https://rates.example",
		version: "0.2.0",
		marketMode: "public",
	});
	for (const endpoint of API_CATALOG) {
		const operation = document.paths[endpoint.path].get;
		assert.ok(operation.summary);
		assert.ok(operation.description);
		assert.ok(operation.responses["200"]);
		assert.ok(operation.responses["200"].content["application/json"].schema);
	}
});

test("/openapi.json is public metadata and reflects the live Market mode", async () => {
	for (const mode of ["public", "private"]) {
		const controller = new ApiDocsController(services(mode));
		const response = await controller.route(
			new Request("https://rates.example/openapi.json"),
			new URL("https://rates.example/openapi.json"),
		);
		assert.equal(response.status, 200);
		const payload = await response.json();
		assert.equal(payload["x-drd"].market_mode, mode);
		assert.equal(
			response.headers.get("Access-Control-Allow-Origin"),
			"*",
		);
	}
});

test("/docs and /docs/ render the same live public documentation surface", async () => {
	for (const path of ["/docs", "/docs/"]) {
		const controller = new ApiDocsController(services("private"));
		const response = await controller.route(
			new Request(`https://rates.example${path}`),
			new URL(`https://rates.example${path}`),
		);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("Content-Type"), /text\/html/);
		const html = await response.text();
		assert.match(html, /DRD RATE MANAGER API/);
		assert.match(html, /Market <strong>PRIVATE<\/strong>/);
		for (const endpoint of API_CATALOG) {
			assert.ok(html.includes(endpoint.path), endpoint.path);
		}
	}
});

test("docs page shows current auth examples and isolated token placeholders only", async () => {
	const privateController = new ApiDocsController(services("private"));
	const privateResponse = await privateController.route(
		new Request("https://rates.example/docs"),
		new URL("https://rates.example/docs"),
	);
	const privateHtml = await privateResponse.text();
	assert.match(privateHtml, /Bearer drd_mkt_YOUR_TOKEN/);
	assert.match(privateHtml, /Bearer drd_core_YOUR_TOKEN/);
	assert.match(privateHtml, /Market and Core credentials are isolated/);

	const publicController = new ApiDocsController(services("public"));
	const publicResponse = await publicController.route(
		new Request("https://rates.example/docs"),
		new URL("https://rates.example/docs"),
	);
	const publicHtml = await publicResponse.text();
	assert.match(publicHtml, /Market <strong>PUBLIC<\/strong>/);
	assert.match(publicHtml, /curl &quot;https:\/\/rates\.example\/api\/v1\/market&quot;/);
});

test("docs are self-contained and disclose no real admin path, raw secret or third-party script", async () => {
	const controller = new ApiDocsController(services("public"));
	const response = await controller.route(
		new Request("https://rates.example/docs"),
		new URL("https://rates.example/docs"),
	);
	const html = await response.text();
	assert.doesNotMatch(html, /<script/i);
	assert.doesNotMatch(html, /https:\/\/cdn|unpkg|jsdelivr/i);
	assert.doesNotMatch(html, /\/admin\/api\/v1/);
	assert.doesNotMatch(html, /drd_(?:mkt|core)_[A-Za-z0-9_-]{20,}/);
	assert.match(html, /Web Admin management endpoints are internal/);
});

test("docs responses use no-store and browser hardening headers", async () => {
	const controller = new ApiDocsController(services("public"));
	const response = await controller.route(
		new Request("https://rates.example/docs"),
		new URL("https://rates.example/docs"),
	);
	assert.match(response.headers.get("Cache-Control"), /no-store/);
	assert.equal(response.headers.get("X-Frame-Options"), "DENY");
	assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
	assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
	assert.match(response.headers.get("X-Content-Type-Options"), /nosniff/);
});

test("docs OPTIONS is anonymous and non-GET mutations are rejected", async () => {
	const controller = new ApiDocsController(services("public"));
	const options = await controller.route(
		new Request("https://rates.example/openapi.json", { method: "OPTIONS" }),
		new URL("https://rates.example/openapi.json"),
	);
	assert.equal(options.status, 204);

	const mutation = await controller.route(
		new Request("https://rates.example/docs", { method: "POST" }),
		new URL("https://rates.example/docs"),
	);
	assert.equal(mutation.status, 405);
});

test("docs controller yields unrelated paths without touching Market mode", async () => {
	let calls = 0;
	const controller = new ApiDocsController({
		config: { version: "0.2.0" },
		apiAccess: {
			async marketMode() {
				calls += 1;
				return "public";
			},
		},
	});
	assert.equal(
		await controller.route(
			new Request("https://rates.example/api/v1/market"),
			new URL("https://rates.example/api/v1/market"),
		),
		null,
	);
	assert.equal(calls, 0);
});

test("Application wires docs before API/Admin routing so /docs is a first-class public surface", async () => {
	const source = await readFile(
		new URL("../src/app/application.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /new ApiDocsController\(this\.services\)/);
	const docsIndex = source.indexOf("this.apiDocs.route(request, url)");
	const apiIndex = source.indexOf("this.api.route(request, url)");
	const adminIndex = source.indexOf("this.webAdminUi.route(request, url)");
	assert.ok(docsIndex >= 0);
	assert.ok(apiIndex > docsIndex);
	assert.ok(adminIndex > docsIndex);
});

test("service root advertises docs and OpenAPI entry points", async () => {
	const source = await readFile(
		new URL("../src/controllers/api.controller.js", import.meta.url),
		"utf8",
	);
	assert.match(source, /docs: "\/docs"/);
	assert.match(source, /openapi: "\/openapi\.json"/);
});

test("controller switch API endpoints and shared catalog remain in sync", async () => {
	const source = await readFile(
		new URL("../src/controllers/api.controller.js", import.meta.url),
		"utf8",
	);
	const cases = [...source.matchAll(/case "(\/api\/v1\/[^"]+)"/g)]
		.map((match) => match[1])
		.sort();
	assert.deepEqual(
		cases,
		API_CATALOG.map((item) => item.path).sort(),
	);
});

test("Phase 15.5 changes neither schema 12 nor application version 0.2.1", async () => {
	const source = await readFile(new URL("../src/config/app.js", import.meta.url), "utf8");
	assert.match(source, /version:\s*"0\.2\.1"/);
	assert.match(source, /schemaVersion:\s*13/);
});
