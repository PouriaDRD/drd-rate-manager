import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeEnv } from "../src/config/runtime-env.js";
import { SecretCrypto } from "../src/crypto/secret-crypto.js";
import { SecureSettingsService } from "../src/services/secure-settings.service.js";

function masterKey(seed = 7) {
	const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index * 13) % 256);
	return Buffer.from(bytes).toString("base64");
}

class MemorySecureRepository {
	constructor() { this.rows = new Map(); }
	async all() { return [...this.rows.entries()].map(([key, row]) => ({ key, ...row })); }
	async upsert(key, encrypted) {
		this.rows.set(key, { ...encrypted, createdAt: Date.now(), updatedAt: Date.now() });
	}
}

test("AES-GCM round-trip works and plaintext is not stored in ciphertext", async () => {
	const cryptoService = new SecretCrypto(masterKey());
	const encrypted = await cryptoService.encrypt("telegram.bot_token", "secret-token");
	assert.notEqual(encrypted.ciphertext, "secret-token");
	assert.equal(await cryptoService.decrypt("telegram.bot_token", encrypted), "secret-token");
});

test("encryption uses a fresh IV for the same secret/value", async () => {
	const cryptoService = new SecretCrypto(masterKey());
	const first = await cryptoService.encrypt("telegram.bot_token", "same");
	const second = await cryptoService.encrypt("telegram.bot_token", "same");
	assert.notEqual(first.iv, second.iv);
	assert.notEqual(first.ciphertext, second.ciphertext);
});

test("AAD prevents ciphertext from being moved between secret names", async () => {
	const cryptoService = new SecretCrypto(masterKey());
	const encrypted = await cryptoService.encrypt("telegram.bot_token", "value");
	await assert.rejects(() => cryptoService.decrypt("coingecko.api_key", encrypted), /Unable to decrypt secure setting/);
});

test("wrong master key cannot decrypt existing secure settings", async () => {
	const encrypted = await new SecretCrypto(masterKey(1)).encrypt("telegram.bot_token", "value");
	await assert.rejects(() => new SecretCrypto(masterKey(2)).decrypt("telegram.bot_token", encrypted), /Unable to decrypt secure setting/);
});

test("legacy ENV secrets migrate to encrypted repository when master key is configured", async () => {
	const repository = new MemorySecureRepository();
	const env = {
		APP_MASTER_KEY: masterKey(),
		TELEGRAM_BOT_TOKEN: "bot-token",
		TELEGRAM_WEBHOOK_SECRET: "hook-secret",
		COINGECKO_API_KEY: "cg-key",
		CLOUDFLARE_API_TOKEN: "cf-key",
	};
	const service = new SecureSettingsService(env, repository, new SecretCrypto(env.APP_MASTER_KEY));
	const status = await service.refresh();
	assert.equal(status.encryptedCount, 4);
	assert.equal(status.legacyFallbackKeys.length, 0);
	assert.equal(service.get("telegram.bot_token"), "bot-token");
	assert.equal(JSON.stringify(repository.rows.get("telegram.bot_token")).includes("bot-token"), false);
});

test("encrypted D1 remains the source after legacy ENV is removed", async () => {
	const repository = new MemorySecureRepository();
	const key = masterKey();
	await new SecureSettingsService({ APP_MASTER_KEY: key, TELEGRAM_BOT_TOKEN: "persisted-token" }, repository, new SecretCrypto(key)).refresh();
	const second = new SecureSettingsService({ APP_MASTER_KEY: key }, repository, new SecretCrypto(key));
	await second.refresh();
	assert.equal(second.get("telegram.bot_token"), "persisted-token");
	assert.equal(second.status().secrets["telegram.bot_token"].source, "encrypted_d1");
});

test("existing encrypted rows fail closed when APP_MASTER_KEY is missing", async () => {
	const repository = new MemorySecureRepository();
	const key = masterKey();
	await new SecureSettingsService({ APP_MASTER_KEY: key, TELEGRAM_BOT_TOKEN: "token" }, repository, new SecretCrypto(key)).refresh();
	const service = new SecureSettingsService({}, repository, new SecretCrypto(""));
	await assert.rejects(() => service.refresh(), /APP_MASTER_KEY is required/);
});

test("before migration, legacy ENV still works without a master key", async () => {
	const repository = new MemorySecureRepository();
	const service = new SecureSettingsService({ TELEGRAM_BOT_TOKEN: "legacy-token" }, repository, new SecretCrypto(""));
	const status = await service.refresh();
	assert.equal(service.get("telegram.bot_token"), "legacy-token");
	assert.deepEqual(status.legacyFallbackKeys, ["telegram.bot_token"]);
});

test("secure status never exposes plaintext values", async () => {
	const repository = new MemorySecureRepository();
	const key = masterKey();
	const service = new SecureSettingsService({ APP_MASTER_KEY: key, TELEGRAM_BOT_TOKEN: "never-show-me" }, repository, new SecretCrypto(key));
	const status = await service.refresh();
	assert.equal(JSON.stringify(status).includes("never-show-me"), false);
});

test("runtime env resolves managed secrets through SecureSettingsService", () => {
	const raw = { DB: { marker: true }, TELEGRAM_BOT_TOKEN: "legacy" };
	const service = { get(key) { return key === "telegram.bot_token" ? "encrypted-token" : ""; } };
	const runtime = createRuntimeEnv(raw, service);
	assert.equal(runtime.TELEGRAM_BOT_TOKEN, "encrypted-token");
	assert.equal(runtime.DB, raw.DB);
});
