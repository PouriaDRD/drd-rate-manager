import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	PASSWORD_HASH_CONFIG,
	PasswordHasher,
} from "../src/auth/password-hasher.js";

const MASTER_KEY_A = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const MASTER_KEY_B = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

test("PasswordHasher uses the Workers-safe PBKDF2 ceiling with a secret pepper", () => {
	assert.equal(
		PASSWORD_HASH_CONFIG.algorithm,
		"HMAC-SHA256-PEPPER+PBKDF2-HMAC-SHA256",
	);
	assert.equal(PASSWORD_HASH_CONFIG.iterations, 100_000);
	assert.equal(PASSWORD_HASH_CONFIG.maxWorkersIterations, 100_000);
	assert.equal(PASSWORD_HASH_CONFIG.saltBytes, 16);
	assert.equal(PASSWORD_HASH_CONFIG.hashBytes, 32);
	assert.equal(PASSWORD_HASH_CONFIG.pepperSource, "APP_MASTER_KEY");
	assert.equal(PASSWORD_HASH_CONFIG.pepperVersion, 1);
});

test("PasswordHasher hashes and verifies only with the same APP_MASTER_KEY", async () => {
	const hasher = new PasswordHasher(MASTER_KEY_A);
	const password = "DRD-release-check-2026!";
	const hashed = await hasher.hash(password);

	assert.equal(
		hashed.passwordAlgorithm,
		"HMAC-SHA256-PEPPER+PBKDF2-HMAC-SHA256",
	);
	assert.equal(hashed.passwordIterations, 100_000);
	assert.ok(hashed.passwordHash);
	assert.ok(hashed.passwordSalt);

	const record = {
		password_algorithm: hashed.passwordAlgorithm,
		password_iterations: hashed.passwordIterations,
		password_hash: hashed.passwordHash,
		password_salt: hashed.passwordSalt,
	};

	assert.equal(await hasher.verify(password, record), true);
	assert.equal(await hasher.verify("wrong-password", record), false);
	assert.equal(
		await new PasswordHasher(MASTER_KEY_B).verify(password, record),
		false,
	);
});

test("PasswordHasher fails closed when APP_MASTER_KEY is absent or invalid", async () => {
	await assert.rejects(
		() => new PasswordHasher().hash("a-secure-password"),
		/APP_MASTER_KEY is required/,
	);
	await assert.rejects(
		() => new PasswordHasher("not-base64").hash("a-secure-password"),
		/APP_MASTER_KEY/,
	);
});

test("PasswordHasher rejects work factors above the Cloudflare Workers PBKDF2 cap", () => {
	assert.throws(
		() => new PasswordHasher(MASTER_KEY_A, 100_001),
		/Cloudflare Workers/,
	);
});

test("PasswordHasher uses HMAC peppering before native PBKDF2", async () => {
	const source = await readFile(
		new URL("../src/auth/password-hasher.js", import.meta.url),
		"utf8",
	);

	assert.match(source, /createHmac/);
	assert.match(source, /pbkdf2Sync/);
	assert.match(source, /APP_MASTER_KEY/);
	assert.match(source, /100_000/);
	assert.doesNotMatch(source, /600_000/);
	assert.doesNotMatch(source, /subtle\.deriveBits/);
	assert.doesNotMatch(source, /subtle\.importKey/);
});

test("WebAuthService derives its production PasswordHasher from APP_MASTER_KEY", async () => {
	const source = await readFile(
		new URL("../src/services/web-auth.service.js", import.meta.url),
		"utf8",
	);
	assert.match(
		source,
		/passwordHasher = new PasswordHasher\(env\?\.APP_MASTER_KEY\)/,
	);
	assert.match(source, /PASSWORD_HASH_CONFIG\.algorithm/);
	assert.match(source, /PASSWORD_HASH_CONFIG\.iterations/);
});
