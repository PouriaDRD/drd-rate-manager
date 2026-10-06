import { createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const DEFAULT_ITERATIONS = 100_000;
const MAX_WORKERS_PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const MASTER_KEY_BYTES = 32;
const ALGORITHM = "HMAC-SHA256-PEPPER+PBKDF2-HMAC-SHA256";
const DIGEST = "sha256";
const PEPPER_DERIVATION_CONTEXT =
	"drd-rate-manager:web-admin-password-pepper:v1";

function toBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
	const normalized = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/");
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
	constructor(masterKey, iterations = DEFAULT_ITERATIONS) {
		this.masterKey = String(masterKey || "").trim();
		const parsedIterations = Number(iterations);
		if (
			!Number.isInteger(parsedIterations) ||
			parsedIterations < 1 ||
			parsedIterations > MAX_WORKERS_PBKDF2_ITERATIONS
		) {
			throw new Error(
				`Password PBKDF2 iterations must be between 1 and ${MAX_WORKERS_PBKDF2_ITERATIONS} on Cloudflare Workers.`,
			);
		}
		this.iterations = parsedIterations;
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
		if (
			!Number.isInteger(iterations) ||
			iterations < 1 ||
			iterations > MAX_WORKERS_PBKDF2_ITERATIONS
		) {
			return false;
		}
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
		const pepperKey = this.#pepperKey();
		const pepperedPassword = createHmac(DIGEST, pepperKey)
			.update(password, "utf8")
			.digest();

		return new Uint8Array(
			pbkdf2Sync(
				pepperedPassword,
				salt,
				iterations,
				HASH_BYTES,
				DIGEST,
			),
		);
	}

	#pepperKey() {
		if (!this.masterKey) {
			throw new Error("APP_MASTER_KEY is required for Web Admin password hashing.");
		}
		let masterBytes;
		try {
			masterBytes = fromBase64Url(this.masterKey);
		} catch {
			throw new Error("APP_MASTER_KEY must be valid base64/base64url.");
		}
		if (masterBytes.byteLength !== MASTER_KEY_BYTES) {
			throw new Error("APP_MASTER_KEY must decode to exactly 32 bytes.");
		}

		return createHmac(DIGEST, masterBytes)
			.update(PEPPER_DERIVATION_CONTEXT, "utf8")
			.digest();
	}
}

export const PASSWORD_HASH_CONFIG = Object.freeze({
	algorithm: ALGORITHM,
	iterations: DEFAULT_ITERATIONS,
	maxWorkersIterations: MAX_WORKERS_PBKDF2_ITERATIONS,
	saltBytes: SALT_BYTES,
	hashBytes: HASH_BYTES,
	pepperSource: "APP_MASTER_KEY",
	pepperVersion: 1,
});
