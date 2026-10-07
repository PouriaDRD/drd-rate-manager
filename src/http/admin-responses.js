const API_SECURITY_HEADERS = Object.freeze({
	"Cache-Control": "no-store, no-cache, must-revalidate",
	Pragma: "no-cache",
	"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
	"Cross-Origin-Opener-Policy": "same-origin",
	"Strict-Transport-Security": "max-age=31536000",
});

const UI_SECURITY_HEADERS = Object.freeze({
	"Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
	"Cross-Origin-Opener-Policy": "same-origin",
	"Strict-Transport-Security": "max-age=31536000",
});

export function adminJsonResponse(payload, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			...API_SECURITY_HEADERS,
			...extraHeaders,
		},
	});
}

export function adminEmptyResponse(status = 204, extraHeaders = {}) {
	return new Response(null, { status, headers: { ...API_SECURITY_HEADERS, ...extraHeaders } });
}

export function adminUiResponse(response, { document: _document = false } = {}) {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(UI_SECURITY_HEADERS)) headers.set(key, value);

	// The Web Admin is a private authenticated control surface. Never allow the
	// document and its ES modules/CSS to drift across releases due to browser or
	// intermediary caching; a mixed shell/module version can expose stale views.
	headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
	headers.set("Pragma", "no-cache");
	headers.set("Expires", "0");

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function adminRedirect(location, status = 308) {
	return new Response(null, {
		status,
		headers: {
			Location: location,
			...UI_SECURITY_HEADERS,
			"Cache-Control": "no-store",
		},
	});
}
