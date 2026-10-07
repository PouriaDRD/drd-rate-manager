# Private Web Admin

## Purpose

The Web Admin is the private browser control plane for DRD Rate Manager.

Its real path is dynamic. This document uses:

```text
/<ADMIN_PATH>/
```

Never replace that placeholder in committed documentation with the real production path.

## UI routing

The Worker resolves the current admin path from Web Admin state and only serves an allowlisted asset set below that private prefix.

The UI shell and assets are served from `public/admin` through `ASSETS`.

## Authentication routes

Private routes include:

```text
POST /<ADMIN_PATH>/api/v1/auth/login
GET  /<ADMIN_PATH>/api/v1/auth/session
POST /<ADMIN_PATH>/api/v1/auth/logout
POST /<ADMIN_PATH>/api/v1/bootstrap
POST /<ADMIN_PATH>/api/v1/auth/credentials
```

Mutation routes require a valid session and CSRF token where applicable.

## Data/control surfaces

The private API covers:

- Dashboard
- Market snapshot / refresh / preview / manual publish
- Automation state/settings/dry-run/force-run/history
- Login History
- Preferences
- Source status, enable/disable and test
- USDT ordering management
- CoinGecko asset management
- Admin management
- API token management
- Configuration management
- System diagnostics

## Configuration Management

Configuration endpoints use the private prefix:

```text
GET   /<ADMIN_PATH>/api/v1/configuration
PATCH /<ADMIN_PATH>/api/v1/configuration/runtime
PATCH /<ADMIN_PATH>/api/v1/configuration/secrets/<KEY>
```

Runtime updates are catalog-validated and persisted to D1.

Secret replacement:

- is replace-only;
- requires CSRF;
- requires current-password confirmation;
- never returns previous plaintext;
- cannot edit `APP_MASTER_KEY`.

## System diagnostics

```text
GET /<ADMIN_PATH>/api/v1/system
```

The system snapshot includes bounded, secret-safe state for:

- application/runtime;
- D1;
- cache;
- automation;
- providers/health/circuits;
- admins;
- runtime settings readiness;
- secure settings readiness;
- metrics;
- alerts;
- configuration ownership/migration readiness.

This endpoint is also the source for proof-driven configuration cleanup snapshots.

## Login history

Login History supports pagination and result filtering.

Supported result classes include:

```text
success
failure
locked
```

The UI must have explicit loading, empty, data, and failure states.

## Session UX

The frontend has a neutral session boot gate. It must not flash the authenticated shell before session state is known, and it must not flash the login screen during a valid logged-in refresh.

Expired/invalid sessions are handled centrally.

## Browser E2E

Playwright covers Chromium, Firefox, and WebKit.

Important regression areas include:

- login/logout;
- neutral boot gate;
- expired session;
- every navigation view;
- API Management;
- Login History;
- Configuration Management;
- error/empty/data states;
- safe DOM/XSS payload handling;
- mobile navigation;
- private asset cache behavior.

## Operational cautions

Manual market publish and force-run are real production actions. Do not use them during smoke testing unless a real publication is intended.

Provider test buttons are safer for targeted connectivity validation.

## Related documents

- [Security](security.md)
- [Configuration](configuration.md)
- [Development](development.md)
