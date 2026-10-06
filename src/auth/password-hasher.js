import { pbkdf2Sync, randomBytes } from "node:crypto";

const DEFAULT_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const ALGORITHM = "PBKDF2-HMAC-SHA256";
const DIGEST = "sha256";

function toBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
	const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function constantTimeEqual(left, right) {
	const a = left instanceof Uint8Array ? left : new Uint8Array(left);
	const b = right instanceof Uint8Array ? right : new Uint8Array(right);
	let diff = a.length ^ b.length;
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		diff |= (a[index % Math.max(a.length, 1)] || 0) ^ (b[index % Math.max(b.length, 1)] || 0);
	}
	return diff === 0;
}

export class PasswordHasher {
	constructor(iterations = DEFAULT_ITERATIONS) {
		this.iterations = Math.max(DEFAULT_ITERATIONS, Number(iterations) || DEFAULT_ITERATIONS);
	}

	async hash(password) {
		const salt = new Uint8Array(randomBytes(SALT_BYTES));
		const hash = this.#derive(String(password), salt, this.iterations);
		return {
			passwordHash: toBase64Url(hash),
			passwordSalt: toBase64Url(salt),
			passwordAlgorithm: ALGORITHM,
			passwordIterations: this.iterations,
		};
	}

	async verify(password, record) {
		if (!record || record.password_algorithm !== ALGORITHM) return false;
		const iterations = Number(record.password_iterations || 0);
		if (!Number.isFinite(iterations) || iterations < 1) return false;
		try {
			const salt = fromBase64Url(record.password_salt);
			const expected = fromBase64Url(record.password_hash);
			const actual = this.#derive(String(password), salt, iterations);
			return constantTimeEqual(actual, expected);
		} catch {
			return false;
		}
	}

	#derive(password, salt, iterations) {
		return new Uint8Array(
			pbkdf2Sync(
				password,
				salt,
				iterations,
				HASH_BYTES,
				DIGEST,
			),
		);
	}
}

export const PASSWORD_HASH_CONFIG = Object.freeze({
	algorithm: ALGORITHM,
	iterations: DEFAULT_ITERATIONS,
	saltBytes: SALT_BYTES,
	hashBytes: HASH_BYTES,
});
