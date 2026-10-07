# External API

## Public documentation

```text
GET /
GET /docs
GET /openapi.json
```

`/openapi.json` is OpenAPI `3.1.0`.

The public API specification intentionally excludes the private Web Admin path.

## Endpoint audiences

### Market

```text
GET /api/v1/market
GET /api/v1/assets
GET /api/v1/sources
GET /api/v1/sources/usdt
```

### Core

```text
GET /api/v1/automation
GET /api/v1/system
GET /api/v1/system/database
```

## Market access mode

Market API mode is stored in D1 as:

```text
market_api_mode
```

Supported modes:

```text
public
private
```

When public, Market endpoints can be called anonymously.

When private, they require a Market token.

Invalid/unrecognized mode values normalize fail-safe to private behavior.

## Core access

Core endpoints always require a valid Core token.

## Token namespaces

```text
drd_mkt_*   Market scope
drd_core_*  Core scope
```

Scope isolation is strict. A valid token of the wrong type receives `403 wrong_scope`.

Missing, invalid, disabled, revoked, or expired tokens receive unauthorized responses.

## Authorization header

Protected endpoints expect:

```http
Authorization: Bearer <TOKEN>
```

Never log this header.

## Token storage

A newly issued token uses random bytes and is returned to the operator once.

Only a SHA-256 hash and non-secret display prefix are persisted.

Token records track:

- name;
- type;
- enabled state;
- expiration;
- last use;
- usage count;
- revocation;
- creator metadata;
- timestamps.

## API behavior

`GET /api/v1/market` returns the shared cached market snapshot, including market values, quality/cache metadata, and normalized output.

`GET /api/v1/sources` returns cached source status and USDT management/resolution metadata without forcing provider refresh.

`GET /api/v1/sources/usdt` also reads cached source state; it is not a live provider probe endpoint.

System/database endpoints are operational APIs and remain Core-protected.

## CORS

The public API controller handles `OPTIONS` through the configured CORS response path.

Private Web Admin APIs are separate and must not be treated as public integration endpoints.

## Error model

Protected API authorization errors use a structured shape containing:

```json
{
  "success": false,
  "message": "Unauthorized",
  "error": {
    "code": "missing_token",
    "required_scope": "core"
  }
}
```

Actual code/message varies by failure.

## Source of truth

The generated OpenAPI document is the contract for external integrations. If this document and `/openapi.json` differ, update documentation to match code rather than exposing private/internal routes.

## Related documents

- [Security](security.md)
- [Web Admin](web-admin.md)
