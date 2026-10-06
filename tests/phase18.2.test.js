import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	PASSWORD_HASH_CONFIG,
	PasswordHasher,
} from "../src/auth/password-hasher.js";

test("PasswordHasher keeps the existing 600k PBKDF2 security contract", () => {
	assert.equal(PASSWORD_HASH_CONFIG.algorithm, "PBKDF2-HMAC-SHA256");
	assert.equal(PASSWORD_HASH_CONFIG.iterations, 600_000);
	assert.equal(PASSWORD_HASH_CONFIG.saltBytes, 16);
	assert.equal(PASSWORD_HASH_CONFIG.hashBytes, 32);
});

test("PasswordHasher hashes and verifies with the native node:crypto backend", async () => {
	const hasher = new PasswordHasher();
	const password = "DRD-release-check-2026!";
	const hashed = await hasher.hash(password);

	assert.equal(hashed.passwordAlgorithm, "PBKDF2-HMAC-SHA256");
	assert.equal(hashed.passwordIterations, 600_000);
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
});

test("PasswordHasher no longer uses Workers WebCrypto PBKDF2 deriveBits", async () => {
	const source = await readFile(
		new URL("../src/auth/password-hasher.js", import.meta.url),
		"utf8",
	);

	assert.match(source, /from "node:crypto"/);
	assert.match(source, /pbkdf2Sync/);
	assert.doesNotMatch(source, /subtle\.deriveBits/);
	assert.doesNotMatch(source, /subtle\.importKey/);
});
