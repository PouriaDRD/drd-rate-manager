# DRD Rate Manager v0.2.0

DRD Rate Manager is a modular Cloudflare Worker for Telegram-based market operations, resilient provider aggregation, scheduled publishing, Web Admin management, scoped external APIs, and D1-backed operational/security state.

Application version: `0.2.0`

Schema version: **13**

## Current architecture

```text
Cloudflare Worker
├── Application / composition root
├── Public API + OpenAPI/docs controllers
├── Private Web Admin controllers + static assets
├── Telegram administration controller
│   ├── market/source management
│   ├── automation
│   ├── admins
│   ├── API management
│   ├── system diagnostics
│   ├── login security/history
│   └── required-channel membership
├── Services
│   ├── MarketService / MarketPublisher
│   ├── AutomationService / AutomationManagementService
│   ├── ProviderResilienceService / ProviderHealthService
│   ├── ApiTokenService / ApiAccessService / ApiManagementService
│   ├── WebAuthService / LoginHistoryService / WebLoginAlertService
│   ├── RequiredMembershipService
│   └── SystemManagementService / OperationalAlertService
└── D1 repositories
```

`src/index.js` is the Worker entrypoint. Static Web Admin assets live under `public/admin` and are served through the private `ASSETS` binding with `run_worker_first` enabled.

## Major capabilities

### Market and providers

- CoinGecko global crypto/metal proxy data.
- USDT/Toman priority: **Wallex → Tabdeal → Exir**.
- WallGold local gold source.
- D1-backed market cache with stale-value recovery.
- Provider cooldown/circuit-breaker behavior.
- Provider health scoring and diagnostics without implicit refreshes.
- Publication-quality gate prevents severe partial snapshots from being published.

### Automation

- Minute Cron (`* * * * *`) with aligned publication slots.
- Configurable publish interval and quiet hours.
- Retry semantics after failed publication.
- Distributed D1 locking to avoid duplicate publication.
- Dry run, force run, execution history and real-time Web Admin countdown.

### Web Admin security

- Dynamic/private admin path.
- HMAC-SHA256 password peppering derived from APP_MASTER_KEY, followed by PBKDF2-HMAC-SHA256 at the Cloudflare Workers 100,000-iteration ceiling.
- HttpOnly + Secure + SameSite=Strict sessions.
- CSRF protection for mutations.
- Login rate limiting and lockout.
- Persistent Login Security history with IP/User-Agent/Cloudflare metadata.
- Telegram Owner notification on successful Web Admin login and fresh lockout.
- Login history available in both Web Admin and Owner-only Telegram UI.

Raw passwords, session tokens, CSRF tokens, cookies and Authorization headers must never be persisted in login history or operational logs.

### Scoped external API

Two isolated token namespaces are supported:

```text
drd_mkt_*   Market scope
drd_core_*  Core scope
```

Market API mode can be `public` or `private`. Core endpoints always require Core scope. Raw API tokens are shown only once and only hashes are stored.

Public API documentation:

```text
GET /docs
GET /openapi.json
```

The OpenAPI document never exposes the private Web Admin path.

### Required Telegram membership

Regular Telegram Admins must be members of every required channel before protected bot operations are available.

Permanent immutable channels:

```text
@DRDNetwork
@DRDrate
```

The Owner can add up to the service-defined limit of extra public channels. Before an extra channel is accepted, the bot verifies that the chat is supported and that the bot itself is an Administrator there.

The Owner bypasses membership enforcement to prevent administrative lockout. `/id` remains available for onboarding.

## Telegram commands

```text
/start
/menu
/help
/id
```

## External API surface

Service metadata:

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

Private Web Admin APIs intentionally are not listed as public external API contracts.

## D1 storage

Schema 13 bootstraps and maintains the operational tables used by the application, including:

```text
app_meta
settings
secure_settings
admins
admin_input_state
audit_logs
source_status
coingecko_assets
market_cache
runtime_locks
automation_runs
api_tokens
web_admin_users
web_admin_sessions
web_auth_attempts
web_admin_login_history
```

Required-channel extras reuse the existing `settings` table; Phase 17 introduced no schema migration.

## Configuration ownership

Configuration is split into three categories:

1. **Deployment/infrastructure identity** — Worker/D1/assets bindings and permanent deployment values.
2. **Runtime settings** — managed through D1 after migration, with legacy ENV only as an explicit bootstrap fallback.
3. **Secure settings** — encrypted in D1 under `APP_MASTER_KEY`, with legacy Worker secrets used only during migration where still required.

Use `.env.example` as the ownership reference. Never commit real production secrets.

Important secure values include:

```text
APP_MASTER_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
COINGECKO_API_KEY
CLOUDFLARE_API_TOKEN
```

`APP_MASTER_KEY` is permanent infrastructure secret material and must not be rotated casually because existing encrypted secure settings depend on it.

## Web Admin bootstrap

On a fresh database the Web Admin bootstrap account/path is intentionally temporary. Complete bootstrap immediately, replacing the default username, password and admin path. Completing bootstrap invalidates existing sessions.

Do not publish the resulting private admin path in README, public API docs, logs or support screenshots.

## Local validation

Install dependencies:

```bash
npm install
```

Run the complete test suite:

```bash
npm test
```

Run syntax and text-format stability checks:

```bash
npm run check
```

Run the complete release candidate gate:

```bash
npm run release:check
```

This command performs **no deployment**.

For repository-only release preflight:

```bash
npm run release:preflight
```

For a real production Wrangler file with no template placeholders:

```bash
npm run release:preflight -- --strict-config --wrangler wrangler.production.jsonc --require-clean
```

## Configuration migration finalization

Legacy ENV cleanup is proof-driven. Obtain the authenticated System API snapshot and first run:

```bash
npm run config:finalize -- system-snapshot.json
```

That command is a dry-run by default. Only after the migration snapshot reports readiness and the plan has been reviewed should `--write` be considered.

It never deploys and never deletes Cloudflare secrets automatically.

## Production release

Production deployment remains an explicit operator action. The repository does not auto-deploy from `release:check`.

Before deployment:

- pass `npm run release:check`;
- verify a clean candidate commit;
- validate the actual Cloudflare bindings/configuration;
- verify the bot is Administrator in `@DRDNetwork`, `@DRDrate`, and every extra required channel;
- export the remote D1 database;
- prepare a rollback plan.

Then follow [`docs/release-checklist.md`](docs/release-checklist.md) for manual deployment and post-deploy verification.

## Security invariants

- Never store or log Web Admin plaintext passwords.
- Never store raw Web Admin session or CSRF tokens.
- Never persist raw API tokens after the one-time creation/rotation response.
- Never expose Telegram bot secrets or provider API keys.
- Never include request Authorization headers/cookies in operational logs.
- Authentication and access-control decisions fail closed.
- Observability/history/notification failures must not replace a legitimate successful authentication result where explicitly designed to fail open.
- Public docs must never disclose the dynamic Web Admin path.

## Release readiness

Candidate validation and production verification are intentionally separate:

- `npm run release:check` validates the candidate locally.
- `docs/release-checklist.md` covers backup, manual deployment, smoke checks and rollback evidence.

Do not treat a green local test suite alone as production verification.
