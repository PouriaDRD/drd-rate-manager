import { PASSWORD_HASH_CONFIG, PasswordHasher } from "../auth/password-hasher.js";
import {
	WEB_AUTH,
	clearSessionCookie,
	normalizeUsername,
	parseCookies,
	requestIp,
	requestUserAgent,
	sessionCookie,
	validateAdminPath,
	validatePassword,
	validateUsername,
} from "../auth/web-auth-utils.js";

const encoder = new TextEncoder();
const DUMMY_RECORD = Object.freeze({
	password_algorithm: PASSWORD_HASH_CONFIG.algorithm,
	password_iterations: PASSWORD_HASH_CONFIG.iterations,
	password_salt: "AAAAAAAAAAAAAAAAAAAAAA",
	password_hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
});

function cryptoApi() {
	if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
		throw new Error("Web Crypto API is unavailable");
	}
	return globalThis.crypto;
}

function toBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
	const digest = await cryptoApi().subtle.digest("SHA-256", encoder.encode(String(value)));
	return toBase64Url(new Uint8Array(digest));
}

function randomToken(bytes = 32) {
	const value = new Uint8Array(bytes);
	cryptoApi().getRandomValues(value);
	return toBase64Url(value);
}

export class WebAuthService {
	constructor(
		env,
		users,
		sessions,
		attempts,
		passwordHasher = new PasswordHasher(env?.APP_MASTER_KEY),
		loginHistory = null,
	) {
		this.env = env;
		this.users = users;
		this.sessions = sessions;
		this.attempts = attempts;
		this.passwordHasher = passwordHasher;
		this.loginHistory = loginHistory;
	}

	async ensureBootstrapAdmin() {
		let user = await this.users.getPrimary();
		if (user) return user;
		const hashed = await this.passwordHasher.hash(WEB_AUTH.defaultPassword);
		user = await this.users.createBootstrap({
			username: WEB_AUTH.defaultUsername,
			adminPath: WEB_AUTH.defaultAdminPath,
			...hashed,
		});
		return user;
	}

	async routingState() {
		const user = await this.ensureBootstrapAdmin();
		return this.#publicUser(user);
	}

	async login(request, usernameInput, passwordInput) {
		const username = normalizeUsername(usernameInput);
		const attemptKey = await this.#attemptKey(request, username);
		const now = Date.now();
		await Promise.all([
			this.sessions.pruneExpired?.(now),
			this.attempts.prune?.(now - 24 * 60 * 60 * 1000),
		]);
		const attempt = await this.attempts.get(attemptKey);
		if (attempt && Number(attempt.locked_until || 0) > now) {
			await this.#recordLoginHistory(request, {
				username,
				result: "locked",
				reason: "rate_limited",
				createdAt: now,
			});
			return {
				ok: false,
				status: 429,
				error: "Too many login attempts.",
				securityEvent: {
					username,
					result: "locked",
					reason: "rate_limited",
					createdAt: now,
				},
				retryAfterSeconds: Math.max(1, Math.ceil((Number(attempt.locked_until) - now) / 1000)),
			};
		}

		const user = await this.users.getByUsername(username);
		const valid = await this.passwordHasher.verify(passwordInput, user || DUMMY_RECORD);
		if (!user || !valid) {
			const failure = await this.attempts.recordFailure(attemptKey, now, {
				windowMs: WEB_AUTH.loginWindowMs,
				maxFailures: WEB_AUTH.maxLoginFailures,
				lockMs: WEB_AUTH.loginLockMs,
			});
			const lockedNow = failure.lockedUntil > now;
			await this.#recordLoginHistory(request, {
				userId: user?.id ?? null,
				username,
				result: lockedNow ? "locked" : "failure",
				reason: lockedNow ? "invalid_credentials_lockout" : "invalid_credentials",
				createdAt: now,
			});
			return {
				ok: false,
				status: failure.lockedUntil > now ? 429 : 401,
				error: "Invalid username or password.",
				securityEvent: {
					userId: user?.id ?? null,
					username,
					result: lockedNow ? "locked" : "failure",
					reason: lockedNow ? "invalid_credentials_lockout" : "invalid_credentials",
					createdAt: now,
				},
				retryAfterSeconds: failure.lockedUntil > now
					? Math.max(1, Math.ceil((failure.lockedUntil - now) / 1000))
					: 0,
			};
		}

		await this.attempts.clear(attemptKey);
		await this.users.touchLogin(user.id, now);
		const session = await this.#createSession(request, user, now);
		await this.#recordLoginHistory(request, {
			userId: user.id,
			username,
			result: "success",
			reason: "authenticated",
			sessionRef: session.sessionRef,
			createdAt: now,
		});
		return {
			ok: true,
			status: 200,
			user: this.#publicUser(user),
			csrfToken: session.csrfToken,
			cookie: sessionCookie(session.token),
			securityEvent: {
				userId: user.id,
				username,
				result: "success",
				reason: "authenticated",
				sessionRef: session.sessionRef,
				createdAt: now,
			},
		};
	}

	async authenticate(request, { requireCsrf = false } = {}) {
		const token = parseCookies(request)[WEB_AUTH.cookieName];
		if (!token) return null;
		const tokenHash = await sha256(token);
		const session = await this.sessions.get(tokenHash);
		if (!session) return null;
		const now = Date.now();
		if (
			Number(session.expires_at || 0) <= now ||
			now - Number(session.last_seen_at || 0) > WEB_AUTH.idleSessionMs
		) {
			await this.sessions.remove(tokenHash);
			return null;
		}
		const user = await this.users.getPrimary();
		if (!user || Number(user.id) !== Number(session.user_id)) return null;
		if (Number(user.credential_version || 0) !== Number(session.credential_version || 0)) {
			await this.sessions.remove(tokenHash);
			return null;
		}
		if (requireCsrf) {
			const csrfToken = String(request.headers.get("X-CSRF-Token") || "");
			if (!csrfToken || (await sha256(csrfToken)) !== String(session.csrf_hash || "")) return null;
		}
		if (now - Number(session.last_seen_at || 0) > 5 * 60 * 1000) {
			await this.sessions.touch(tokenHash, now);
		}
		return { user, session, tokenHash };
	}

	async confirmPassword(authenticated, passwordInput) {
		const user = authenticated?.user;
		if (!user) {
			throw Object.assign(new Error("Authentication is required."), {
				statusCode: 401,
				code: "authentication_required",
			});
		}
		const valid = await this.passwordHasher.verify(String(passwordInput || ""), user);
		if (!valid) {
			throw Object.assign(new Error("Current password is incorrect."), {
				statusCode: 403,
				code: "password_confirmation_failed",
			});
		}
		return true;
	}

	async rotateCsrf(authenticated) {
		const csrfToken = randomToken();
		await this.sessions.rotateCsrf(authenticated.tokenHash, await sha256(csrfToken));
		return csrfToken;
	}

	async logout(authenticated) {
		if (authenticated?.tokenHash) await this.sessions.remove(authenticated.tokenHash);
		return clearSessionCookie();
	}

	async completeBootstrap(authenticated, input) {
		const user = authenticated.user;
		if (!Number(user.must_complete_bootstrap)) throw new Error("Bootstrap is already complete.");
		const username = validateUsername(input.username);
		const password = validatePassword(input.password);
		const adminPath = validateAdminPath(input.admin_path);
		if (username === WEB_AUTH.defaultUsername) throw new Error("Default username must be changed.");
		if (password === WEB_AUTH.defaultPassword) throw new Error("Default password must be changed.");
		if (adminPath === WEB_AUTH.defaultAdminPath) throw new Error("Default admin path must be changed.");
		const hashed = await this.passwordHasher.hash(password);
		const updated = await this.users.completeBootstrap(user.id, {
			username,
			adminPath,
			...hashed,
		});
		await this.sessions.removeAllForUser(user.id);
		return this.#publicUser(updated);
	}

	async changeCredentials(authenticated, input) {
		const user = authenticated.user;
		const currentPassword = String(input.current_password || "");
		if (!(await this.passwordHasher.verify(currentPassword, user))) {
			throw new Error("Current password is incorrect.");
		}
		const username = input.username === undefined ? user.username : validateUsername(input.username);
		const adminPath = input.admin_path === undefined ? user.admin_path : validateAdminPath(input.admin_path);
		let hashed = {
			passwordHash: user.password_hash,
			passwordSalt: user.password_salt,
			passwordAlgorithm: user.password_algorithm,
			passwordIterations: user.password_iterations,
		};
		if (input.password !== undefined && String(input.password) !== "") {
			const password = validatePassword(input.password);
			if (await this.passwordHasher.verify(password, user)) throw new Error("New password must be different.");
			hashed = await this.passwordHasher.hash(password);
		}
		if (username === user.username && adminPath === user.admin_path && hashed.passwordHash === user.password_hash) {
			throw new Error("No credential changes were provided.");
		}
		const updated = await this.users.updateCredentials(user.id, {
			username,
			adminPath,
			...hashed,
		});
		await this.sessions.removeAllForUser(user.id);
		return this.#publicUser(updated);
	}

	async #createSession(request, user, now) {
		const token = randomToken();
		const csrfToken = randomToken();
		const tokenHash = await sha256(token);
		await this.sessions.create({
			tokenHash,
			userId: user.id,
			csrfHash: await sha256(csrfToken),
			credentialVersion: Number(user.credential_version || 0),
			createdAt: now,
			lastSeenAt: now,
			expiresAt: now + WEB_AUTH.absoluteSessionMs,
			ipHash: await sha256(requestIp(request)),
			userAgent: requestUserAgent(request),
		});
		return { token, csrfToken, sessionRef: tokenHash.slice(0, 16) };
	}

	async #recordLoginHistory(request, details) {
		if (!this.loginHistory?.record) return;
		try {
			await this.loginHistory.record(request, details);
		} catch (error) {
			console.warn({
				timestamp: new Date().toISOString(),
				level: "warn",
				event: "web_auth.login_history_write_failed",
				result: String(details?.result || "unknown"),
				message: String(error?.message || error).slice(0, 300),
			});
		}
	}

	async #attemptKey(request, username) {
		return sha256(`login|${requestIp(request)}|${username}`);
	}

	#publicUser(user) {
		return {
			id: Number(user.id),
			username: String(user.username),
			adminPath: String(user.admin_path),
			mustCompleteBootstrap: Boolean(Number(user.must_complete_bootstrap)),
			lastLoginAt: Number(user.last_login_at || 0),
		};
	}
}
