# Security

## Core invariants

Never persist, log, publish, or include in documentation:

```text
plaintext Web Admin passwords
raw Web Admin session tokens
raw CSRF tokens
raw API tokens
Telegram bot token
Telegram webhook secret
CoinGecko API key
Cloudflare API token
APP_MASTER_KEY
Cookie headers
Authorization headers
real private Web Admin path
```

Authentication and authorization decisions fail closed.

Where explicitly designed, secondary observability such as login-history writes or security notifications may fail open so that an otherwise valid authentication result is not replaced by a telemetry failure.

## APP_MASTER_KEY

`APP_MASTER_KEY` must decode to exactly 32 bytes and is stored only as a Cloudflare Worker secret.

It is used as the root for derived cryptographic material. It must not be regenerated as part of deploys, cleanup, documentation work, or routine maintenance.

## Secure settings encryption

Managed secure settings use:

```text
AES-256-GCM + HKDF-SHA256
key version: 1
IV size: 12 bytes
authentication tag: 128 bits
```

Each secure-setting key receives derived key material and associated authenticated data includes the logical secret key, algorithm, and key version.

D1 stores ciphertext, IV, algorithm, key version, and timestamps—not plaintext.

## Web Admin authentication

Current policy:

```text
session cookie: __Host-drd_admin_session
absolute session lifetime: 7 days
idle session lifetime: 12 hours
login failure window: 15 minutes
lock duration: 15 minutes
maximum failures before lock: 5
```

The session cookie is:

```text
HttpOnly
Secure
SameSite=Strict
Path=/
```

Sessions store only token hashes. CSRF state is also stored as a hash.

Credential changes invalidate existing sessions through credential-version/session invalidation.

## Bootstrap

A fresh environment uses temporary bootstrap values internally. Bootstrap must be completed immediately.

Production documentation, screenshots, issues, and logs must never reveal the final private path.

Username requirements:

- lowercase normalization;
- starts with a letter;
- 3–64 characters;
- letters, digits, dot, dash, underscore.

Password requirements:

- 12–128 characters after bootstrap.

Admin path requirements:

- starts with a letter;
- 4–64 characters;
- lowercase letters, digits, dash, underscore;
- cannot be a reserved path.

## CSRF

State-changing private Web Admin requests require an authenticated session and valid `X-CSRF-Token`.

A missing/invalid CSRF token rejects the mutation. It must not silently downgrade to an unauthenticated mutation or destroy an otherwise valid session as a side effect.

## API tokens

External API tokens have isolated scopes:

```text
drd_mkt_*  Market
drd_core_* Core
```

Tokens are generated from random bytes, shown only on creation/rotation, then hashed with SHA-256 before persistence.

A token is rejected when it is:

- missing;
- malformed/unrecognized;
- unknown;
- wrong scope;
- disabled;
- revoked;
- expired.

Usage metadata is persisted after successful authentication.

## Private Web Admin assets

The private UI is served through Worker routing. Private assets use no-store behavior and the private path is not part of OpenAPI/public docs.

## Login history

Login history may include bounded operational metadata such as username, result, reason, IP address, User-Agent, Cloudflare ray/location metadata, session reference, and timestamp.

It must never include plaintext credentials, raw cookies, raw sessions, CSRF tokens, or Authorization headers.

## Audit logging

Audit records should record bounded action metadata, not raw mutation bodies containing secrets.

A failed audit write must not create false success records or corrupt the primary operation outcome where audit is intentionally fail-open.

## Operational checklist

Before release:

- confirm `APP_MASTER_KEY` exists and is unchanged;
- confirm production Wrangler vars contain only deployment identity and no legacy runtime/secure values;
- confirm the cleaned production Worker secret inventory contains only `APP_MASTER_KEY`;
- confirm encrypted secure settings are healthy;
- run secret-leakage regression tests;
- verify public docs contain no private path;
- verify session/CSRF/token tests;
- verify logs do not expose Authorization/Cookie headers.

## Related documents

- [Configuration](configuration.md)
- [Web Admin](web-admin.md)
- [External API](api.md)
