# Configuration

## Ownership model

Configuration is deliberately split into three ownership classes.

### Deployment and infrastructure

These remain outside D1 runtime ownership:

```text
DB
ASSETS
APP_NAME
APP_VERSION
APP_MASTER_KEY
```

`DB` and `ASSETS` are Worker bindings. `APP_NAME` and `APP_VERSION` are deployment identity. `APP_MASTER_KEY` is permanent infrastructure secret material.

### Runtime settings

Runtime settings catalog version: `3`.

There are 25 managed runtime keys:

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

After migration, D1 is the source of truth. Legacy ENV keys are compatibility/bootstrap inputs only.

### Secure settings

Secure settings catalog version: `1`.

```text
telegram.bot_token
telegram.webhook_secret
coingecko.api_key
cloudflare.api_token
```

Managed secure values are encrypted in D1. The management surface is replace-only: existing plaintext is never returned.

## Runtime validation

Runtime settings are validated by the central catalog.

Important rules include:

- timezone must be accepted by `Intl.DateTimeFormat`;
- Telegram owner ID must match the expected numeric format;
- Telegram handle is normalized with `@`;
- CoinGecko plan is `demo` or `pro`;
- CoinGecko top limit is bounded;
- asset IDs are normalized CSV identifiers;
- provider URLs must be HTTP(S);
- database limit must be a bounded integer.

Unknown runtime keys are rejected by managed mutation paths.

## Web Admin configuration

The private Configuration view provides:

- a catalog snapshot;
- runtime value updates;
- replace-only secure setting updates;
- current-password confirmation for secret replacement;
- provider/CoinGecko test actions;
- `APP_MASTER_KEY` status without exposing its value.

Runtime changes are written to D1 and become effective through configuration refresh; they do not require Worker deployment.

## Migration readiness

System diagnostics calculate whether legacy inputs can be removed.

Readiness requires:

- runtime configuration fully migrated to D1;
- no invalid D1 runtime keys;
- no legacy/default runtime fallback keys;
- no secure legacy fallback keys;
- no missing secure settings;
- encrypted secure coverage complete;
- configuration ownership metadata valid.

The resulting diagnostics expose:

```text
runtime_ready
secure_ready
can_remove_legacy_runtime_env
can_remove_legacy_secret_env
can_remove_all_legacy_env
blockers
```

## Cleanup finalizer

Cleanup is proof-driven.

Capture a fresh authenticated private System snapshot, then run:

```bash
npm run config:finalize -- system-snapshot.json --wrangler wrangler.production.jsonc
```

The command is dry-run by default.

Only after reviewing the plan:

```bash
npm run config:finalize -- system-snapshot.json --wrangler wrangler.production.jsonc --write
```

The finalizer validates snapshot freshness and catalog/ownership versions before changing a Wrangler file. The default proof window is 15 minutes with limited future clock skew tolerance.

The finalizer:

- removes legacy runtime vars from the selected Wrangler file;
- removes legacy secure vars only if they are present as normal vars;
- preserves deployment identity;
- reports Worker secrets that still require manual cleanup;
- does not deploy;
- does not delete Cloudflare secrets.

## APP_MASTER_KEY rule

`APP_MASTER_KEY` is never part of normal legacy cleanup.

Do not regenerate or casually rotate it. Existing encrypted secure settings are derived from it and Web Admin password protection also depends on derived keying material.

## Template files

`.env.example` documents both current ownership and legacy migration inputs. `wrangler.jsonc` is a repository template and may contain placeholders.

A real production Wrangler file must stay outside source control and must pass strict preflight before release.

## Version skew warning

During staged deployment, old and new Worker versions may share D1. If an older Worker writes an older catalog version to metadata, version fields can oscillate.

Migration-bearing releases must therefore verify the candidate itself and re-check metadata after final promotion.

## Related documents

- [Security](security.md)
- [Database](database.md)
- [Deployment](deployment.md)
