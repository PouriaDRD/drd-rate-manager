const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const SECRET_CRYPTO_ALGORITHM = "AES-256-GCM+HKDF-SHA256";
export const SECRET_KEY_VERSION = 1;

const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const HKDF_SALT = textEncoder.encode("drd-rate-manager:secure-settings:v1");

function bytesToBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
	const normalized = String(value || "").trim().replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	let binary;
	try {
		binary = atob(padded);
	} catch {
		throw new Error("APP_MASTER_KEY must be valid base64/base64url.");
	}
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function aadFor(secretKey, keyVersion) {
	return textEncoder.encode(`drd-rate-manager|secure-setting|${secretKey}|${SECRET_CRYPTO_ALGORITHM}|v${keyVersion}`);
}

export class SecretCrypto {
	constructor(masterKey) {
		this.masterKey = String(masterKey || "").trim();
	}

	get configured() {
		return Boolean(this.masterKey);
	}

	validateMasterKey() {
		if (!this.configured) throw new Error("APP_MASTER_KEY is not configured.");
		const bytes = base64UrlToBytes(this.masterKey);
		if (bytes.byteLength !== MASTER_KEY_BYTES) throw new Error("APP_MASTER_KEY must decode to exactly 32 bytes.");
		return bytes;
	}

	async encrypt(secretKey, plaintext, keyVersion = SECRET_KEY_VERSION) {
		const key = await this.#deriveKey(secretKey, keyVersion);
		const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadFor(secretKey, keyVersion), tagLength: 128 }, key, textEncoder.encode(String(plaintext ?? "")));
		return {
			ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
			iv: bytesToBase64Url(iv),
			algorithm: SECRET_CRYPTO_ALGORITHM,
			keyVersion,
		};
	}

	async decrypt(secretKey, record) {
		if (!record) throw new Error(`Encrypted secure setting not found: ${secretKey}`);
		const algorithm = String(record.algorithm || "");
		const keyVersion = Number(record.keyVersion || record.key_version || 0);
		if (algorithm !== SECRET_CRYPTO_ALGORITHM) throw new Error(`Unsupported secure setting algorithm: ${algorithm || "unknown"}`);
		if (!Number.isInteger(keyVersion) || keyVersion < 1) throw new Error(`Invalid secure setting key version for ${secretKey}.`);
		const key = await this.#deriveKey(secretKey, keyVersion);
		const iv = base64UrlToBytes(record.iv);
		if (iv.byteLength !== IV_BYTES) throw new Error(`Invalid IV for secure setting: ${secretKey}`);
		try {
			const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aadFor(secretKey, keyVersion), tagLength: 128 }, key, base64UrlToBytes(record.ciphertext));
			return textDecoder.decode(decrypted);
		} catch {
			throw new Error(`Unable to decrypt secure setting: ${secretKey}`);
		}
	}

	async #deriveKey(secretKey, keyVersion) {
		const masterBytes = this.validateMasterKey();
		const ikm = await crypto.subtle.importKey("raw", masterBytes, "HKDF", false, ["deriveKey"]);
		return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: textEncoder.encode(`secret:${secretKey}:v${keyVersion}`) }, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
	}
}
