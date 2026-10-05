const SECURITY_HEADERS = Object.freeze({
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

export function adminJsonResponse(payload, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			...SECURITY_HEADERS,
			...extraHeaders,
		},
	});
}

export function adminEmptyResponse(status = 204, extraHeaders = {}) {
	return new Response(null, { status, headers: { ...SECURITY_HEADERS, ...extraHeaders } });
}
