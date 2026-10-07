# Database and Persistence

## D1

DRD Rate Manager uses Cloudflare D1 through the `DB` binding.

Current schema version: `13`.

`Database.ensureReady()` performs idempotent bootstrap work before normal HTTP handling.

## Tables

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

## app_meta

Tracks application database/catalog metadata including:

```text
schema_version
runtime_settings_version
secure_settings_version
```

Do not assume metadata is immune to mixed-version deployment skew. Older and newer Worker versions can share the same D1 database.

## settings

Stores general operational state and D1-owned runtime configuration.

Examples include:

- bot enabled state;
- automation intervals/quiet hours/retry state;
- market API mode;
- source enable flags;
- USDT ordering metadata;
- required-membership extras;
- managed Runtime Settings Catalog values;
- alert/preferences state.

## secure_settings

Stores encrypted managed secrets.

Columns include:

```text
key
ciphertext
iv
algorithm
key_version
created_at
updated_at
```

Plaintext is not stored.

## Web Admin tables

`web_admin_users` stores the primary administrative identity and credential metadata.

`web_admin_sessions` stores only session-token hashes plus CSRF hash and bounded session metadata.

`web_auth_attempts` supports rate limiting/lockout.

`web_admin_login_history` records bounded security events.

## Market state

`source_status` stores cached provider results/status.

`coingecko_assets` stores discovered asset configuration.

`market_cache` stores the shared market snapshot, fetch/expiry timestamps, and last error.

`runtime_locks` provides distributed coordination for refresh/publish work.

## Automation

`automation_runs` stores run mode/status/timestamps/actor/message/partial/error/details.

History persistence must not replace the semantic result of a publication when history storage is designed to fail open.

## API tokens

`api_tokens` stores token metadata and token hashes only.

Raw API tokens are not persisted.

## Bootstrap behavior

Bootstrap creates missing tables/indexes and performs allowed additive column migration.

Default operational settings and runtime catalog seed values use `INSERT OR IGNORE`, which preserves existing D1 values.

Catalog version metadata is then written to `app_meta`.

## Backup

Create a remote D1 export immediately before production release.

Example:

```bash
npx --yes wrangler@<PINNED_VERSION> d1 export <DATABASE_NAME> --remote --output=./backups/pre-release.sql
```

Keep backups out of Git. They may contain operational/security metadata.

## Restore caution

Rolling back Worker code does not automatically mean D1 should be restored.

Database restoration is a separate, potentially destructive operation and must be justified against the migration characteristics of the release.

## Related documents

- [Configuration](configuration.md)
- [Deployment](deployment.md)
- [Troubleshooting](troubleshooting.md)
