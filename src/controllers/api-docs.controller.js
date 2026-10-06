import { APP } from "../config/app.js";
import { API_AUDIENCES, API_CATALOG } from "../api/catalog.js";
import { buildOpenApiDocument } from "../api/openapi.js";

function docsHeaders(contentType) {
	return {
		"Content-Type": contentType,
		"Cache-Control": "no-store, max-age=0",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"Referrer-Policy": "no-referrer",
		"Content-Security-Policy":
			"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
	};
}

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function endpointAuth(endpoint, marketMode) {
	if (endpoint.audience === API_AUDIENCES.CORE) {
		return {
			label: "CORE TOKEN",
			className: "private",
			description: "Bearer drd_core_* required",
		};
	}
	if (marketMode === "private") {
		return {
			label: "MARKET TOKEN",
			className: "private",
			description: "Bearer drd_mkt_* required",
		};
	}
	return {
		label: "PUBLIC",
		className: "public",
		description: "No authentication required",
	};
}

function curlExample(origin, endpoint, marketMode) {
	const auth = endpointAuth(endpoint, marketMode);
	const url = `${origin}${endpoint.path}`;
	if (auth.className === "public") return `curl "${url}"`;
	const placeholder =
		endpoint.audience === API_AUDIENCES.CORE
			? "drd_core_YOUR_TOKEN"
			: "drd_mkt_YOUR_TOKEN";
	return `curl -H "Authorization: Bearer ${placeholder}" "${url}"`;
}

function renderDocs({ origin, version, marketMode }) {
	const endpointCards = API_CATALOG.map((endpoint) => {
		const auth = endpointAuth(endpoint, marketMode);
		const curl = curlExample(origin, endpoint, marketMode);
		return `<article class="endpoint">
			<div class="endpoint-head">
				<div class="endpoint-route"><span class="method">${escapeHtml(endpoint.method)}</span><code>${escapeHtml(endpoint.path)}</code></div>
				<span class="access ${auth.className}">${escapeHtml(auth.label)}</span>
			</div>
			<h3>${escapeHtml(endpoint.summary)}</h3>
			<p>${escapeHtml(endpoint.description)}</p>
			<div class="meta">
				<span>Scope <strong>${escapeHtml(endpoint.audience.toUpperCase())}</strong></span>
				<span>${escapeHtml(auth.description)}</span>
			</div>
			<pre><code>${escapeHtml(curl)}</code></pre>
			<p class="responses">Responses: <code>200</code>${auth.className === "private" ? " · <code>401</code> · <code>403</code>" : ""}</p>
		</article>`;
	}).join("");

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width,initial-scale=1">
	<title>DRD RATE MANAGER API Docs</title>
	<style>
		:root{color-scheme:dark;background:#07090d;color:#edf2f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
		*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#080b11 0%,#05070a 100%);min-height:100vh}
		main{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:56px 0 80px}
		.hero{padding:28px;border:1px solid #202735;border-radius:24px;background:#0c111a;box-shadow:0 20px 60px rgba(0,0,0,.25)}
		.eyebrow{font-size:.75rem;letter-spacing:.14em;color:#8fa7c7;text-transform:uppercase}h1{margin:10px 0 12px;font-size:clamp(2rem,5vw,3.6rem);line-height:1.05}
		.hero p{max-width:780px;color:#9ba9bc;line-height:1.75}.status-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
		.pill,.access{display:inline-flex;align-items:center;border:1px solid #2a3445;border-radius:999px;padding:7px 11px;font-size:.72rem;font-weight:800;letter-spacing:.05em}
		.pill strong{margin-left:6px}.public{border-color:#285a42;color:#8de0b4;background:#0d2018}.private{border-color:#533c23;color:#efc480;background:#21170d}
		.links{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.links a{color:#d7e6ff;text-decoration:none;border:1px solid #2a3445;border-radius:12px;padding:10px 13px;background:#101722}
		.section-title{margin:42px 0 16px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
		.endpoint{padding:20px;border:1px solid #1d2634;border-radius:18px;background:#0b1018;min-width:0}.endpoint-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
		.endpoint-route{display:flex;align-items:center;gap:9px;min-width:0}.endpoint-route code{overflow-wrap:anywhere}.method{font-size:.7rem;font-weight:900;color:#9ec6ff}
		h3{margin:18px 0 8px}.endpoint p{color:#96a5b9;line-height:1.65}.meta{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0;color:#a9b8cb;font-size:.8rem}.meta span{border:1px solid #1e2938;border-radius:10px;padding:8px}
		pre{overflow:auto;margin:14px 0 0;padding:14px;border:1px solid #1d2634;border-radius:12px;background:#05080d;color:#c9e0ff;font-size:.78rem}.responses{font-size:.8rem}
		.note{margin-top:18px;padding:18px;border:1px solid #273247;border-radius:16px;background:#0c121d;color:#9eacc0;line-height:1.7}
		footer{margin-top:32px;color:#65748a;font-size:.8rem}
		@media(max-width:760px){main{padding-top:24px}.hero{padding:20px}.grid{grid-template-columns:1fr}.endpoint-head{flex-direction:column}}
	</style>
</head>
<body>
<main>
	<section class="hero">
		<div class="eyebrow">DRD / External API</div>
		<h1>DRD RATE MANAGER API</h1>
		<p>Integration documentation for the external v1 API. Market and Core credentials are isolated: a Market token cannot access Core endpoints, and a Core token cannot access Market endpoints.</p>
		<div class="status-row">
			<span class="pill">Version <strong>${escapeHtml(version)}</strong></span>
			<span class="pill">API <strong>${escapeHtml(APP.apiVersion)}</strong></span>
			<span class="pill ${marketMode === "public" ? "public" : "private"}">Market <strong>${escapeHtml(marketMode.toUpperCase())}</strong></span>
		</div>
		<div class="links">
			<a href="/openapi.json">OpenAPI 3.1 JSON</a>
			<a href="/">Service root</a>
		</div>
	</section>

	<h2 class="section-title">Authentication</h2>
	<div class="note">
		<strong>Market token:</strong> <code>drd_mkt_*</code> — only Market endpoints.<br>
		<strong>Core token:</strong> <code>drd_core_*</code> — only Core endpoints.<br>
		Send private credentials as <code>Authorization: Bearer &lt;token&gt;</code>. Raw tokens are displayed only once when created or rotated.
	</div>

	<h2 class="section-title">Endpoints</h2>
	<section class="grid">${endpointCards}</section>

	<div class="note">
		This page documents the external integration API only. Web Admin management endpoints are internal session/CSRF endpoints and are intentionally not exposed as token-based integration APIs.
	</div>
	<footer>Generated from the same API catalog used by access enforcement · ${escapeHtml(version)}</footer>
</main>
</body>
</html>`;
}

export class ApiDocsController {
	constructor(services) {
		this.s = services;
	}

	async route(request, url) {
		if (!["/docs", "/docs/", "/openapi.json"].includes(url.pathname)) {
			return null;
		}
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					...docsHeaders("text/plain; charset=utf-8"),
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type",
				},
			});
		}
		if (request.method !== "GET") {
			return new Response(
				JSON.stringify({ success: false, message: "Method not allowed" }),
				{
					status: 405,
					headers: docsHeaders("application/json; charset=utf-8"),
				},
			);
		}

		const marketMode = await this.s.apiAccess.marketMode();
		const origin = url.origin;
		const version = this.s.config.version;

		if (url.pathname === "/openapi.json") {
			return new Response(
				JSON.stringify(
					buildOpenApiDocument({
						origin,
						version,
						marketMode,
						apiVersion: APP.apiVersion,
					}),
					null,
					2,
				),
				{
					status: 200,
					headers: {
						...docsHeaders("application/json; charset=utf-8"),
						"Access-Control-Allow-Origin": "*",
					},
				},
			);
		}

		return new Response(renderDocs({ origin, version, marketMode }), {
			status: 200,
			headers: docsHeaders("text/html; charset=utf-8"),
		});
	}
}
