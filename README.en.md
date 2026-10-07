# DRD Rate Manager — Full English Manual

This is the complete English guide for **DRD Rate Manager**. For the compact GitHub overview, see [`README.md`](README.md).

**Application version:** `0.2.0`
**D1 schema:** `13`
**Runtime settings catalog:** `3`
**Secure settings catalog:** `1`

## 1. Overview

DRD Rate Manager is a modular Cloudflare Workers application for resilient market-rate aggregation, Telegram administration and publishing, scheduled automation, a private Web Admin control plane, scoped external APIs, and D1-backed operational/configuration/security state.

The market pipeline is intentionally multi-provider. USDT/Toman and Iranian 18K gold do not depend on a single primary source. All enabled providers are queried concurrently and the final price is derived from a median-based consensus.

## 2. High-level architecture

```text
Cloudflare Worker
├── Application / Composition Root
├── Public API + OpenAPI
├── Telegram Webhook / Admin Control Plane
├── Private Web Admin
├── Market Aggregation
│   ├── USDT providers
│   ├── Gold providers
│   └── CoinGecko
├── Provider Resilience / Health
├── Market Cache / Stale Fallback
├── Automation / Publishing / Distributed Locks
├── Runtime Configuration
├── Encrypted Secure Settings
├── Web Authentication / Login History
├── API Token Management
├── Operational Metrics / Alerts
└── D1 Repositories
```

`src/index.js` is the Worker entrypoint. Request and scheduled-event orchestration lives in `src/app/application.js`. Private Web Admin assets are under `public/admin` and are served through the `ASSETS` binding with `run_worker_first`.

## 3. Git workflow

The repository uses a strict branch policy:

```text
dev  = all development, testing, commits and pushes
main = production-only
```

Normal development must not happen directly on `main`. A release candidate is fully gated on `dev`; after backup and staged/live smoke validation, `dev` is merged into `main`, and production deployment happens only from `main`.

## 4. USDT/Toman providers

Seven providers are managed:

| Provider | Runtime key | Default |
|---|---|---|
| Wallex | `providers.wallex_api_url` | ON |
| Tabdeal | `providers.tabdeal_api_url` | ON |
| Exir | `providers.exir_api_url` | ON |
| Bitpin | `providers.bitpin_api_url` | ON |
| Nobitex | `providers.nobitex_api_url` | OFF |
| OMPFinex | `providers.ompfinex_api_url` | ON |
| Ramzinex | `providers.ramzinex_api_url` | ON |

Stored/display order:

```text
wallex, tabdeal, exir, bitpin, nobitex, ompfinex, ramzinex
```

This is not a primary/fallback pricing route. The current strategy is `consensus`, and all enabled USDT sources are checked concurrently.

## 5. 18K gold providers

Six providers are managed:

| Provider | Runtime key | Default |
|---|---|---|
| WallGold | `providers.wallgold_api_url` | ON |
| TechnoGold | `providers.technogold_api_url` | ON |
| MelliGold | `providers.melligold_api_url` | OFF |
| Talasea | `providers.talasea_api_url` | ON |
| Milli | `providers.milli_api_url` | ON |
| Gerami | `providers.gerami_api_url` | ON |

All enabled gold sources are checked concurrently and the same consensus resolver is used.

## 6. Consensus and outlier rejection

USDT and gold follow the same algorithm:

1. Keep successful observations with a positive price.
2. Compute the initial median.
3. If there are at least three healthy observations, compare each observation to the median.
4. The outlier threshold is **3%**.
5. If at least two inliers remain, observations outside the threshold are rejected.
6. Recompute the median from accepted observations and round the final value.
7. Return `contributors`, `rejected`, `sampleCount` and `strategy` metadata.
8. With one or two healthy observations, use their median without the three-sample outlier filter.

If no healthy enabled provider remains, consensus fails.

## 7. Mazaneh

Mazaneh is calculated internally from the validated final 18K gram price. It has no independent provider/API:

```js
Math.round(gram18 * 4.6083 * (705 / 750))
```

Its reliability therefore follows the validated gold consensus.

## 8. CoinGecko

CoinGecko supplies global crypto/metal market data. The configured plan is `demo` or `pro`. The API key is a Secure Setting; plan, top limit, default assets and user agent are Runtime Settings.

CoinGecko is not currently a fallback provider for the local USDT/gold consensus.

## 9. Provider resilience and cache behavior

Provider execution includes persisted health/status plus timeout, cooldown/circuit-breaker and resilience behavior.

The market pipeline uses D1-backed caching. A failed refresh can return controlled stale data when a usable cache exists. Lock-storage failure can also degrade to stale cache when available; without usable cache, the pipeline fails closed.

The publication quality gate prevents severely partial/unsafe snapshots from being published.

## 10. Automation and publishing

The Worker Cron runs every minute:

```text
* * * * *
```

Automation supports:

- global enable/disable
- configurable publish interval
- quiet hours
- aligned publication slots
- retry after failure
- D1 distributed locks to prevent duplicate publication
- dry-run and force-run
- execution history
- real-time Web Admin countdown/state
- publication quality gating

## 11. Telegram control plane

Base commands:

```text
/start
/menu
/help
/id
```

Telegram management covers market/source controls, automation, administrators, API management, system/database diagnostics, login security/history and required-channel membership.

### Owner and admins

The Owner has elevated authority. Admin add/remove operations follow the Owner-only policy, and inactive admins cannot act.

### Required membership

Permanent immutable required channels:

```text
@DRDNetwork
@DRDrate
```

Regular admins must be members of every required channel. The Owner bypasses membership enforcement to avoid administrative lockout. Extra channels must pass validation and the bot must be an Administrator before they are accepted.

## 12. Private Web Admin

The Web Admin is a private control plane. Its real path must never be placed in README files, public API docs, public logs, support screenshots or issues.

Main capabilities:

- authentication and session management
- CSRF protection
- bootstrap and forced replacement of default credentials/path
- Login History
- Telegram alerts for successful login and fresh lockout
- Admin Management
- API Management
- Sources / Market / Automation
- System / Database diagnostics
- Full Configuration Management

Public OpenAPI output intentionally does not expose private Web Admin routes.

## 13. Web Admin security

- plaintext passwords are never persisted/logged
- raw session tokens are not stored; hashes are stored
- raw CSRF tokens are not persisted
- cookies are `HttpOnly`, `Secure`, `SameSite=Strict`
- state-changing requests require CSRF
- login rate limiting and lockout are enforced
- login history stores bounded security metadata without secrets/tokens/cookies/Authorization
- credential changes invalidate prior sessions
- password protection derives keying material from `APP_MASTER_KEY`
- PBKDF2-HMAC-SHA256 uses the Cloudflare Workers 100,000-iteration ceiling

## 14. External API

Service metadata/docs:

```text
GET /
GET /docs
GET /openapi.json
```

Market audience:

```text
GET /api/v1/market
GET /api/v1/assets
GET /api/v1/sources
GET /api/v1/sources/usdt
```

Core audience:

```text
GET /api/v1/automation
GET /api/v1/system
GET /api/v1/system/database
```

Telegram webhook:

```text
POST /telegram/webhook
```

Token namespaces:

```text
drd_mkt_*   Market
drd_core_*  Core
```

Raw API tokens are shown only once on create/rotate; only hashes are persisted.

Market API mode can be `public` or `private`. Core endpoints always require Core scope.

## 15. D1 schema

Current D1 schema version: `13`.

Core tables:

```text
app_meta
settings
secure_settings
web_admin_users
web_admin_sessions
web_auth_attempts
web_admin_login_history
admins
source_status
admin_input_state
audit_logs
coingecko_assets
market_cache
runtime_locks
automation_runs
api_tokens
```

`settings` stores operational/runtime values. `secure_settings` stores ciphertext plus encryption metadata.

## 16. Configuration ownership

### Deployment / infrastructure

```text
DB
ASSETS
APP_NAME
APP_VERSION
APP_MASTER_KEY
```

`APP_MASTER_KEY` is permanent infrastructure secret material.

### Runtime settings

Runtime Settings Catalog version `3` contains **25** managed keys:

```text
general.bot_display_name
general.timezone

telegram.owner_id
telegram.channel_id
telegram.channel_handle

coingecko.plan
coingecko.top_limit
coingecko.default_assets
coingecko.user_agent

providers.wallex_api_url
providers.tabdeal_api_url
providers.exir_api_url
providers.wallgold_api_url
providers.bitpin_api_url
providers.nobitex_api_url
providers.ompfinex_api_url
providers.ramzinex_api_url
providers.technogold_api_url
providers.melligold_api_url
providers.talasea_api_url
providers.milli_api_url
providers.gerami_api_url

cloudflare.account_id
cloudflare.d1_database_id
cloudflare.d1_database_limit_mb
```

In a migrated environment, D1 is the source of truth. Legacy ENV values are bootstrap/backward-compatibility inputs only.

### Secure settings

Secure Settings Catalog version `1`:

```text
telegram.bot_token
telegram.webhook_secret
coingecko.api_key
cloudflare.api_token
```

These values are encrypted in D1 under `APP_MASTER_KEY`.

## 17. APP_MASTER_KEY

Do **not** regenerate or casually rotate `APP_MASTER_KEY`.

It protects encrypted secure settings and participates in security derivation. Arbitrary replacement can make existing encrypted settings or dependent authentication material unusable.

For a new installation, generate a strong key and store it only as a Cloudflare Worker Secret. Never commit the production value to Git, README content, logs, tickets or screenshots.

## 18. Full Configuration Management

The private Web Admin configuration surface manages all 25 Runtime Settings and four Secure Settings.

Important behaviors:

- catalog-driven validation
- endpoints for all 13 local providers are managed
- secrets are replace-only; existing plaintext is never returned
- sensitive changes require current-password confirmation
- provider/CoinGecko connectivity tests are available
- runtime configuration can refresh without deployment
- `APP_MASTER_KEY` is status-only and is never displayed

## 19. ENV migration and cleanup

`.env.example` documents migration inputs; this does not imply permanent ENV ownership.

Proof-driven cleanup:

1. Complete Runtime and Secure migration.
2. Authenticated System diagnostics must report full readiness.
3. Capture a fresh authenticated System snapshot.
4. Run dry-run first:

```bash
npm run config:finalize -- system-snapshot.json --wrangler wrangler.production.jsonc
```

5. Review the plan.
6. Only then use:

```bash
npm run config:finalize -- system-snapshot.json --wrangler wrangler.production.jsonc --write
```

The finalizer does not deploy and does not automatically delete Worker Secrets. `APP_MASTER_KEY` is never part of legacy cleanup.

## 20. Version skew during staged deployments

Different Worker versions can execute against the same D1 database. If old and new versions use different catalog versions and bootstrap metadata is rewritten without a downgrade guard, metadata can oscillate between version values.

For migration-bearing releases:

- prove readiness with the same candidate code
- use 0%-traffic/version-override smoke validation
- verify metadata again after promotion
- perform final legacy-secret cleanup only after the new production version is promoted and verified
- future metadata migration should be downgrade-safe/monotonic

## 21. Local setup

Requirements:

- a recent Node.js version compatible with the project
- npm
- Cloudflare account/Wrangler
- Cloudflare D1
- Telegram bot for Telegram features

```bash
git clone https://github.com/PouriaDRD/drd-rate-manager.git
cd drd-rate-manager
git checkout dev
npm install
```

For reproducible/CI installs, `npm ci` can be used because `package-lock.json` is committed.

## 22. Wrangler and D1

`wrangler.jsonc` is a template and intentionally contains placeholders. Real production configuration must not be committed.

Bindings:

```text
DB      Cloudflare D1
ASSETS  public/admin
```

Cron:

```text
* * * * *
```

Before a release, validate the actual production Wrangler file with strict preflight.

## 23. Initial secret

For a new environment:

```bash
wrangler secret put APP_MASTER_KEY
```

Legacy secure inputs may be required during initial migration, but the target architecture reads managed secure values from encrypted D1.

## 24. Web Admin bootstrap

A fresh database starts with a temporary bootstrap account/path. Complete bootstrap immediately and replace the default username, password and private admin path.

Do not expose the final path publicly. Credential changes invalidate prior sessions.

## 25. Tests and quality gates

```bash
npm test
npm run check
npm run test:phase19.8
npm run test:browser
npm run test:browser:chromium
npm run test:hardening
npm run release:preflight
npm run release:check
```

`npm test` uses Node's test runner.

Playwright is pinned to `1.63.0`. Browser E2E runs on Chromium, Firefox and WebKit.

Phase 19.8 details are in [`docs/phase19.8-test-matrix.md`](docs/phase19.8-test-matrix.md).

`release:check` performs no deployment.

## 26. Release procedure

```text
1. Develop on dev
2. Review git status/diff
3. npm test
4. npm run check
5. npm run test:browser
6. npm run release:check
7. Strict production preflight
8. Export a remote D1 backup
9. Upload the release candidate
10. Run 0%-traffic staged smoke / version override
11. Perform live integration verification
12. Merge dev -> main
13. Deploy/promote production only from main
14. Run post-deploy smoke tests
15. Verify database/config metadata
16. Keep rollback candidate until verification is complete
17. Perform approved post-promotion cleanup
```

See [`docs/release-checklist.md`](docs/release-checklist.md).

## 27. Rollback

Before promotion, record the last-known-good Worker Version ID, keep a fresh D1 export and prepare rollback commands/criteria.

Rolling back Worker code is not the same as rolling back database state. Destructive database migrations need their own recovery plan.

## 28. Observability

Diagnostics cover:

- application/runtime integrity
- database status
- provider/source status
- provider health
- automation state/history
- configuration migration readiness
- secure-settings readiness
- admin/login history
- operational metrics/alerts

Diagnostics must remain secret-safe.

## 29. Security invariants

Never persist, log or publicly expose:

```text
Web Admin plaintext password
raw session token
raw CSRF token
raw API token
Telegram bot token
Telegram webhook secret
CoinGecko API key
Cloudflare API token
APP_MASTER_KEY
Cookie header
Authorization header
private Web Admin path
```

Authentication and authorization fail closed.

## 30. Troubleshooting

**Provider failure:** inspect enabled state, source status, HTTP code/latency, managed endpoint and cooldown state.

**Final price looks wrong:** inspect `contributors`, `rejected`, `sampleCount` and the 3% threshold.

**Web Admin login fails:** inspect bootstrap state, credential version, expiry/idle timeout, lockout and `APP_MASTER_KEY`.

**Runtime configuration looks stale:** inspect D1 runtime readiness and the actual Worker version being executed; account for version skew during staged deployments.

**Secure setting missing:** inspect encrypted D1 state and master-key status without logging plaintext.

**Duplicate automation execution:** inspect D1 lock state and run history.

## 31. Important repository paths

```text
src/index.js
src/app/
src/config/
src/controllers/
src/market/
src/services/
src/repositories/
src/api/
src/auth/
src/clients/
src/database/
src/telegram/
src/system/
src/observability/
public/admin/
tests/
e2e/
scripts/
docs/
```

## 32. Related documentation

- [`README.md`](README.md) — compact project overview
- [`README.fa.md`](README.fa.md) — full Persian manual
- [`docs/release-checklist.md`](docs/release-checklist.md) — release checklist
- [`docs/phase19.8-test-matrix.md`](docs/phase19.8-test-matrix.md) — hardening/test matrix

## 33. License

See [`LICENSE`](LICENSE).
