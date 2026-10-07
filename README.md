# DRD Rate Manager

**DRD Rate Manager** is a Cloudflare Workers application for resilient market-rate aggregation, Telegram operations, scheduled publishing, a private Web Admin control plane, scoped external APIs, and D1-backed configuration/security state.

**Current application version:** `0.2.0`
Schema version: **13**
**Runtime settings catalog:** `3`
**Secure settings catalog:** `1`

> Development happens on `dev`. `main` is production-only. Promotion to production is explicit and gated.

## Highlights

- **USDT/Toman consensus** across Wallex, Tabdeal, Exir, Bitpin, Nobitex, OMPFinex and Ramzinex.
- **18K gold consensus** across WallGold, TechnoGold, MelliGold, Talasea, Milli and Gerami.
- Median-based aggregation with **3% outlier rejection** when enough healthy samples exist.
- Internally calculated **Mazaneh** from the validated final 18K gram price.
- Provider health, cooldown/circuit-breaker behavior, D1 cache and stale fallback.
- CoinGecko-backed global crypto/metal data.
- Telegram administration, required-channel enforcement and scheduled publishing.
- Private Web Admin with session security, CSRF protection, login history, API-token management and full configuration management.
- Runtime settings stored in D1; managed secrets encrypted in D1 under `APP_MASTER_KEY`.
- Public OpenAPI/docs surface with separate Market/Core API token scopes.
- Node regression/integration/security tests plus Playwright browser E2E on Chromium, Firefox and WebKit.

## Architecture

```text
Cloudflare Worker
├── HTTP/Public API + OpenAPI
├── Telegram webhook/control plane
├── Private Web Admin + static assets
├── Market aggregation
│   ├── 7 USDT providers
│   ├── 6 gold providers
│   └── CoinGecko
├── Automation / publishing / locks
├── Configuration + encrypted secure settings
├── Observability / health / alerts
└── Cloudflare D1 repositories
```

`src/index.js` is the Worker entrypoint. Web Admin static assets live in `public/admin` and are bound through `ASSETS` with `run_worker_first`.

## Provider model

USDT and gold are **consensus-based**, not primary/fallback routes. Every enabled provider is queried concurrently. Healthy positive observations are aggregated by median; with at least three healthy observations, values more than 3% from the initial median are rejected when at least two inliers remain, then the median is recomputed.

Default-enabled USDT providers: Wallex, Tabdeal, Exir, Bitpin, OMPFinex, Ramzinex. Nobitex is opt-in by default.

Default-enabled gold providers: WallGold, TechnoGold, Talasea, Milli, Gerami. MelliGold is opt-in by default.

## Public API

```text
GET /
GET /docs
GET /openapi.json

GET /api/v1/market
GET /api/v1/assets
GET /api/v1/sources
GET /api/v1/sources/usdt

GET /api/v1/automation
GET /api/v1/system
GET /api/v1/system/database

POST /telegram/webhook
```

Market endpoints use the Market audience; automation/system endpoints use the Core audience. Market access can be configured as public or private; Core endpoints remain Core-scoped.

## Required Telegram membership

Permanent immutable required channels:

```text
@DRDNetwork
@DRDrate
```

Regular Telegram admins must satisfy required-channel membership before protected operations are available; the Owner bypasses this enforcement to prevent administrative lockout.

## Configuration ownership

Configuration is split into three groups:

- **Deployment identity/infrastructure:** Worker bindings plus `APP_NAME`, `APP_VERSION` and permanent `APP_MASTER_KEY`.
- **Runtime settings:** D1-managed values, including Telegram identity, CoinGecko options, Cloudflare metadata and all provider endpoints.
- **Secure settings:** encrypted D1 values for the Telegram bot token, Telegram webhook secret, CoinGecko API key and Cloudflare API token.

`APP_MASTER_KEY` is permanent infrastructure secret material. Do not regenerate or casually rotate it: encrypted secure settings and Web Admin password protection depend on it.

Legacy ENV/Worker secrets exist only as migration compatibility inputs. Production cleanup is proof-driven through the authenticated System diagnostics and `config:finalize`.

## Quick start

```bash
npm install
npm test
npm run check
npm run test:browser
npm run release:check
```

`release:check` performs validation only; it does **not** deploy.

Use `.env.example` and `wrangler.jsonc` as templates. Never commit real secrets, a real private Web Admin path, production cookies, session/CSRF tokens or raw API tokens.

## Release workflow

```text
feature work → dev → full gates → release candidate
             → D1 backup → staged/0% smoke
             → dev → main → production promotion
             → post-deploy verification / rollback evidence
```

Production deployment is always explicit. See [`docs/release-checklist.md`](docs/release-checklist.md).

## Documentation

- [راهنمای کامل فارسی](README.fa.md)
- [Full English manual](README.en.md)
- [Release checklist](docs/release-checklist.md)
- [Phase 19.8 hardening test matrix](docs/phase19.8-test-matrix.md)

## Security invariants

Never persist or log plaintext Web Admin passwords, raw sessions, CSRF tokens, raw API tokens, Telegram/provider secrets, cookies or Authorization headers. Authentication and authorization fail closed. Public docs must never disclose the private Web Admin path.

## License

See [LICENSE](LICENSE).
