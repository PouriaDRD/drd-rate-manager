# Architecture

## Runtime model

DRD Rate Manager is a single Cloudflare Worker application with multiple control planes sharing the same service layer and Cloudflare D1 state.

```text
Request / Scheduled event
        |
        v
src/index.js
        |
        v
Application
├── Public API / OpenAPI
├── Telegram webhook
├── Private Web Admin
└── Scheduled automation
        |
        v
Service composition
├── Market aggregation
├── Provider resilience / health
├── Market cache
├── Automation / publishing
├── Runtime configuration
├── Secure settings
├── Authentication / sessions
├── API tokens
├── Membership enforcement
└── System diagnostics / alerts
        |
        v
D1 repositories + external providers
```

`src/app/container.js` is the dependency composition root. It constructs repositories, configuration services, market clients, security services, automation services, and controllers from the Worker environment.

## Request lifecycle

For normal HTTP requests the application:

1. bootstraps/validates D1 through `Database.ensureReady()`;
2. refreshes encrypted secure settings;
3. refreshes D1-backed runtime configuration;
4. routes public docs/API requests;
5. routes the Telegram webhook;
6. routes private Web Admin UI/API requests;
7. returns a 404 response if no route matches.

This ordering matters because provider clients and control planes should resolve configuration through the same refreshed service state.

## Scheduled lifecycle

The Cron trigger runs once per minute. Scheduled execution refreshes secure/runtime configuration before evaluating automation. Operational alerts are evaluated after the automation tick and also when the tick throws.

The scheduler cadence does not mean every minute is a publish event. Publish intervals, quiet hours, aligned slots, retry state, global enable state, and distributed locks decide whether work should run.

## Major layers

### Configuration

`src/config/` contains application identity, runtime-setting definitions, secure-setting definitions, ownership metadata, migration-readiness rules, and cleanup logic.

Runtime settings are D1-owned after migration. Secure settings are encrypted in D1. `APP_MASTER_KEY` remains an infrastructure-level Worker secret.

### Controllers

`src/controllers/` exposes:

- public API and API docs;
- Telegram webhook handling;
- private Web Admin authentication;
- private Web Admin data/configuration/system/admin/API-token endpoints;
- private Web Admin static UI routing.

The real Web Admin path is dynamic and must not be part of public contracts.

### Market

`src/market/market-sources.js` implements provider adapters and consensus resolution.

USDT and 18K gold are both multi-provider consensus outputs. Provider order is not a primary/fallback route for final pricing.

### Services

`src/services/` contains the main application behavior: market refresh, cache semantics, publishing, automation, health, configuration management, API-token authorization, login history, membership enforcement, alerts, and system diagnostics.

### Repositories

`src/repositories/` isolates D1 access. Repositories cover settings, encrypted secrets, cache, locks, provider status, admins, Web Admin users/sessions/login history, API tokens, audit logs, and automation history.

## Shared-state implications

Multiple Worker versions can execute against the same D1 database during staged rollout. This means code-version skew matters.

A concrete rule for migration-bearing releases is:

- prove readiness on the exact candidate version;
- use zero-percent staged deployment and version override where appropriate;
- promote only after candidate smoke is green;
- verify metadata again after promotion;
- perform legacy secret cleanup only after the new production version is stable.

Bootstrap metadata updates must be designed to avoid downgrading newer catalog metadata when an older Worker version is still receiving traffic.

## Static assets

Private Web Admin assets are stored under `public/admin` and exposed through the `ASSETS` binding with `run_worker_first`. Worker routing remains authoritative, which prevents a public static path from bypassing private-path handling.

## Related documents

- [Configuration](configuration.md)
- [Security](security.md)
- [Providers](providers.md)
- [Database](database.md)
- [Deployment](deployment.md)
