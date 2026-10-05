export const WEB_AUTH = Object.freeze({
	cookieName: "__Host-drd_admin_session",
	defaultUsername: "admin",
	defaultPassword: "admin",
	defaultAdminPath: "admin",
	absoluteSessionMs: 7 * 24 * 60 * 60 * 1000,
	idleSessionMs: 12 * 60 * 60 * 1000,
	loginWindowMs: 15 * 60 * 1000,
	loginLockMs: 15 * 60 * 1000,
	maxLoginFailures: 5,
});

export function normalizeUsername(value) {
	return String(value || "").trim().toLowerCase();
}

export function validateUsername(value) {
	const username = normalizeUsername(value);
	if (!/^[a-z][a-z0-9._-]{2,63}$/.test(username)) {
		throw new Error("Username must start with a letter and contain 3-64 lowercase letters, digits, dot, dash or underscore.");
	}
	return username;
}

export function validatePassword(value, { allowDefault = false } = {}) {
	const password = String(value ?? "");
	if (allowDefault && password === WEB_AUTH.defaultPassword) return password;
	if (password.length < 12 || password.length > 128) {
		throw new Error("Password must contain 12-128 characters.");
	}
	return password;
}

export function normalizeAdminPath(value) {
	return String(value || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
}

export function validateAdminPath(value, { allowDefault = false } = {}) {
	const adminPath = normalizeAdminPath(value);
	if (allowDefault && adminPath === WEB_AUTH.defaultAdminPath) return adminPath;
	if (!/^[a-z][a-z0-9_-]{3,63}$/.test(adminPath)) {
		throw new Error("Admin path must start with a letter and contain 4-64 lowercase letters, digits, dash or underscore.");
	}
	const reserved = new Set(["api", "telegram", "assets", "admin"]);
	if (reserved.has(adminPath)) throw new Error("This admin path is reserved.");
	return adminPath;
}

export function parseCookies(request) {
	const header = String(request.headers.get("Cookie") || "");
	const cookies = {};
	for (const part of header.split(";")) {
		const index = part.indexOf("=");
		if (index <= 0) continue;
		const key = part.slice(0, index).trim();
		const value = part.slice(index + 1).trim();
		if (key) cookies[key] = decodeURIComponent(value);
	}
	return cookies;
}

export function sessionCookie(token) {
	const maxAge = Math.floor(WEB_AUTH.absoluteSessionMs / 1000);
	return `${WEB_AUTH.cookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
	return `${WEB_AUTH.cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function requestIp(request) {
	return String(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown")
		.split(",")[0]
		.trim()
		.slice(0, 128);
}

export function requestUserAgent(request) {
	return String(request.headers.get("User-Agent") || "").slice(0, 512);
}
