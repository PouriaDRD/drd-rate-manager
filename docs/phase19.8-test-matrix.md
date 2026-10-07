# Phase 19.8 — Hardening & Full Test Matrix

This phase is a release blocker for configuration cleanup and the next production release.

## Release rules

- Existing regression suite must remain green.
- Every fixed defect receives a permanent regression test.
- Every real provider must have a managed runtime URL, enable/disable state, test action, validation, persistence, and failure-path coverage.
- Secure values are write-only from management surfaces and must never be returned in plaintext.
- `APP_MASTER_KEY` is permanent infrastructure state and is never editable from Web Admin.
- A single failing mandatory suite blocks release.
- Production rollout remains staged: upload -> 0% -> authenticated/read-only smoke -> explicit promotion.

## Mandatory coverage

### Configuration
- General settings validation and persistence.
- Telegram owner/channel/display configuration.
- CoinGecko plan, top limit, assets, user-agent.
- All 7 USDT provider URLs.
- All 6 Gold provider URLs.
- Cloudflare account/database/limit.
- Secure Telegram bot token, webhook secret, CoinGecko API key, Cloudflare API token.
- Reset/default behavior.
- D1 persistence across refresh/restart.
- No unmanaged provider URL hidden in runtime code.

### Providers & consensus
- Happy response for every source.
- HTTP 4xx/5xx.
- timeout/network error.
- malformed JSON.
- missing/invalid/zero/negative price.
- disabled source.
- one healthy source.
- two healthy sources.
- >=3 source median consensus.
- 3% outlier rejection boundary.
- multiple rejected providers.
- all providers unavailable.
- contributor/rejected/sample-count metadata.
- MelliGold redirect-loop regression.

### Web Admin
- neutral boot gate.
- logged-out refresh.
- logged-in refresh.
- expired/invalid session.
- login/logout.
- every navigation view.
- API Management load/error/empty/data.
- Login History load/error/empty/data/pagination/filter.
- Settings full management.
- safe DOM / XSS payloads.
- private asset no-store cache policy.
- responsive/mobile view.
- owner-only mutations and CSRF.

### API management
- Market/Core token creation.
- one-time secret display.
- enable/disable.
- rotate.
- revoke.
- expiration.
- public/private Market mode.
- wrong token scope.
- expired/revoked token rejection.
- token usage accounting.

### Telegram
- only `/start`, `/menu`, `/help`, `/id` trigger top-level commands.
- ordinary text is ignored outside an input flow.
- unknown slash commands are ignored.
- pending API-token-name input.
- pending add-admin input.
- pending required-channel input.
- cancel/back behavior.
- stale pending input.
- callback routing for every menu branch.
- owner/admin authorization.
- bot global on/off.
- safe escaping of user-controlled content.

### Security
- CSRF rejection.
- malformed/oversized JSON.
- invalid/tampered session.
- bootstrap bypass rejection.
- private admin path isolation.
- no secret leakage in API/System/audit/logs/HTML/Telegram.
- encrypted D1 secure settings.
- APP_MASTER_KEY remains deployment-only.
- XSS/HTML injection payloads.

### Database / concurrency
- fresh bootstrap.
- idempotent migrations.
- legacy database migration.
- missing-table allowed vs forbidden paths.
- D1 read/write failure.
- concurrent market refresh lock.
- concurrent automation slot.
- duplicate publish prevention.
- concurrent API-token rotate/update.

### Automation
- enabled/disabled.
- intervals.
- quiet hours and day boundary.
- Tehran timezone.
- dry-run.
- force-run.
- retry.
- already-published slot.
- provider partial/failure behavior.
- countdown refresh behavior.

### Release smoke
- root/version.
- docs/OpenAPI.
- Market.
- USDT consensus.
- Gold consensus.
- all sources.
- CoinGecko.
- authenticated Web Admin.
- API Management.
- Login History.
- configuration status.
- Telegram input/callback smoke.
- rollback target recorded and tested.

## Phase 19.8A included now

- Full 13-provider runtime configuration catalog.
- Config getters for all source URLs.
- `.env.example` provider parity.
- Private Web Admin assets set to `no-store`.
- Telegram top-level text routing hardened.
- Regression tests for the above.

Remaining work is intentionally split into subsequent 19.8 slices so each slice can be tested before commit/push.


## Phase 19.8B completed

- Full runtime configuration management in Web Admin.
- All 13 provider URLs exposed through the managed catalog.
- Four managed secure settings are replace-only and never returned in plaintext.
- Current Web Admin password confirmation protects secret replacement.
- `APP_MASTER_KEY` remains deployment-only and immutable.
- Runtime configuration catalog advanced independently of the D1 schema.

## Phase 19.8C completed

- Real-browser Playwright coverage added.
- Chromium, Firefox and WebKit are mandatory browser gates.
- Neutral session boot gate prevents login/app-shell flash.
- API Management and Login History blank-view regressions are covered.
- Full Configuration Management is exercised in the browser.
- Session expiry is handled centrally.
- Mobile navigation and visible failure states are covered.
- Trace, screenshot and video evidence are retained on browser failure.

## Phase 19.8D — final integration, security and failure hardening

This final slice intentionally adds no product feature or schema/version change.

Mandatory focus:

- Telegram pending-input cancellation is deterministic.
- Back/cancel callbacks cannot leave stale add-admin state behind.
- Market cache remains usable when refresh-lock persistence fails.
- A missing cache still fails closed when refresh coordination is unavailable.
- Cache write failures cannot destroy the last known-good snapshot.
- Expired and credential-invalid Web Admin sessions are removed.
- Invalid CSRF fails closed without destroying a valid session.
- Failed runtime/secure persistence cannot emit false audit-success records.
- Audit storage itself remains fail-open and never logs mutation payload data.
- Automation history-storage failure cannot replace publish success/failure semantics.
- The full Node, browser, syntax, format and diff gates remain mandatory.

After 19.8D is green, Phase 19.8 is considered complete and the project may proceed to configuration cleanup/release preparation.
