import { errorMessage, failure } from "../utils/core.js";

export const PROVIDER_RESILIENCE_POLICY = Object.freeze({
	attemptLeaseMs: 15_000,
	cooldownMs: Object.freeze({
		configuration: 10 * 60_000,
		rate_limited: 2 * 60_000,
		access_denied: 5 * 60_000,
		timeout: 30_000,
		network_error: 30_000,
		server_error: 45_000,
		client_error: 2 * 60_000,
		invalid_response: 30_000,
		unknown: 30_000,
	}),
});

export function classifyProviderFailure(result = {}) {
	const rawStatus = result.status;
	const numericStatus =
		rawStatus === null || rawStatus === undefined || rawStatus === ""
			? Number.NaN
			: Number(rawStatus);
	const status = Number.isFinite(numericStatus) ? numericStatus : null;
	const message = String(result.message || "").toLowerCase();

	if (
		message.includes("missing") ||
		message.includes("not configured") ||
		message.includes("configuration")
	) {
		return "configuration";
	}
	if (status === 429) return "rate_limited";
	if (status === 401 || status === 403) return "access_denied";
	if (status === 408 || status === 425 || (status != null && status >= 500)) {
		return "server_error";
	}
	if (status != null && status >= 400 && status < 500) return "client_error";
	if (status != null && status >= 200 && status < 300) return "invalid_response";
	if (status == null) {
		if (
			message.includes("timeout") ||
			message.includes("timed out") ||
			message.includes("abort")
		) {
			return "timeout";
		}
		return "network_error";
	}
	return "unknown";
}

/**
 * D1-backed provider circuit breaker using runtime_locks as persistent leases.
 *
 * The same persistent lease is also exposed through inspect()/inspectAll() for
 * read-only diagnostics. Diagnostics never perform provider network requests.
 */
export class ProviderResilienceService {
	constructor(
		locks,
		{
			policy = PROVIDER_RESILIENCE_POLICY,
			now = () => Date.now(),
		} = {},
	) {
		this.locks = locks;
		this.policy = policy;
		this.now = now;
	}

	async execute(source, operation) {
		const gate = await this.#beginAttempt(source);
		if (!gate.allowed) {
			const result = failure(
				gate.state === "open"
					? `Provider cooldown active until ${new Date(gate.retryAt).toISOString()}`
					: "Provider probe already in progress",
			);
			return {
				...result,
				skipped: true,
				retryAt: gate.retryAt,
				resilience: {
					state: gate.state,
					classification: "cooldown",
					retryAt: gate.retryAt,
				},
			};
		}

		let result;
		try {
			result = await operation();
		} catch (error) {
			result = failure(errorMessage(error));
		}

		if (result?.success) {
			await this.#release(gate.key, gate.token);
			return {
				...result,
				resilience: {
					state: "closed",
					classification: null,
					retryAt: 0,
				},
			};
		}

		const classification = classifyProviderFailure(result);
		const cooldownMs = this.#cooldownMs(classification);
		const retryAt = this.now() + cooldownMs;
		await this.#cooldown(gate.key, gate.token, cooldownMs);

		return {
			...result,
			retryAt,
			resilience: {
				state: gate.token ? "open" : "unmanaged",
				classification,
				cooldownMs,
				retryAt,
			},
		};
	}

	async inspect(source, now = this.now()) {
		const key = this.#key(source);
		try {
			const lease = await this.locks.peek(key);
			if (!lease) {
				return this.#inspection(source, "closed", 0, 0, null);
			}

			const retryAt = Number(lease.expiresAt || 0);
			const remainingMs = Math.max(0, retryAt - now);
			const cooldownLease = this.#isCooldownLease(lease);
			let state = "closed";

			if (remainingMs > 0) {
				state = cooldownLease ? "open" : "probe_in_progress";
			} else if (cooldownLease) {
				state = "half_open_ready";
			}

			return this.#inspection(source, state, retryAt, remainingMs, null);
		} catch (error) {
			return this.#inspection(source, "unknown", 0, 0, errorMessage(error));
		}
	}

	async inspectAll(sources, now = this.now()) {
		const names = [...new Set((sources || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
		const entries = await Promise.all(
			names.map(async (name) => [name, await this.inspect(name, now)]),
		);
		return Object.fromEntries(entries);
	}

	async #beginAttempt(source) {
		const key = this.#key(source);
		const now = this.now();

		try {
			const previous = await this.locks.peek(key);
			if (previous && previous.expiresAt > now) {
				return {
					allowed: false,
					key,
					token: null,
					state: this.#activeLeaseState(previous),
					retryAt: previous.expiresAt,
				};
			}

			const token = await this.locks.acquire(key, this.policy.attemptLeaseMs);
			if (!token) {
				const active = await this.locks.peek(key);
				return {
					allowed: false,
					key,
					token: null,
					state: active ? this.#activeLeaseState(active) : "probe_in_progress",
					retryAt: active?.expiresAt || now + this.policy.attemptLeaseMs,
				};
			}

			const wasCooldown =
				previous &&
				previous.expiresAt <= now &&
				this.#isCooldownLease(previous);

			return {
				allowed: true,
				key,
				token,
				state: wasCooldown ? "half_open" : "closed",
				retryAt: 0,
			};
		} catch {
			return {
				allowed: true,
				key,
				token: null,
				state: "unmanaged",
				retryAt: 0,
			};
		}
	}

	#key(source) {
		return `provider:${String(source || "").trim().toLowerCase()}`;
	}

	#isCooldownLease(lease) {
		return Number(lease?.leaseMs || 0) > this.policy.attemptLeaseMs + 1000;
	}

	#activeLeaseState(lease) {
		return this.#isCooldownLease(lease) ? "open" : "probe_in_progress";
	}

	#inspection(source, state, retryAt, remainingMs, error) {
		return {
			source: String(source || "").trim().toLowerCase(),
			state,
			retryAt: Number(retryAt || 0),
			remainingMs: Number(remainingMs || 0),
			error: error || null,
		};
	}

	#cooldownMs(classification) {
		const value = Number(this.policy.cooldownMs?.[classification]);
		return Number.isFinite(value) && value > 0
			? value
			: Number(this.policy.cooldownMs?.unknown || 30_000);
	}

	async #cooldown(key, token, cooldownMs) {
		if (!token) return false;
		try {
			return await this.locks.extend(key, token, cooldownMs);
		} catch {
			return false;
		}
	}

	async #release(key, token) {
		if (!token) return;
		try {
			await this.locks.release(key, token);
		} catch {
			// Lock expiry remains a safe fallback if release fails.
		}
	}
}
