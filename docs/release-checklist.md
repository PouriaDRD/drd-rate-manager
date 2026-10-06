# DRD Rate Manager Release Checklist

This checklist is deliberately split into candidate validation and production actions. Nothing in `npm run release:check` deploys the Worker or mutates Cloudflare resources.

## 1. Candidate validation

Run from a clean project checkout:

```bash
npm install
npm run release:check
```

The command runs the complete Node test suite, syntax/format checks, and the repository release preflight.

Before tagging or deploying, also verify:

```bash
git status
git log -1 --oneline
```

For a final clean-tree check:

```bash
npm run release:preflight -- --require-clean
```

The repository `wrangler.jsonc` is a template and intentionally contains `<YOUR_...>` placeholders. Validate an actual production Wrangler file with:

```bash
npm run release:preflight -- --strict-config --wrangler wrangler.production.jsonc --require-clean
```

Never put production secrets in a committed Wrangler file.

## 2. Production prerequisites

Confirm all of the following before deployment:

- The D1 `DB` binding points to the intended `drd-rate-manager-db` database.
- The `ASSETS` binding points to `./public/admin` and `run_worker_first` remains enabled.
- The Cron trigger remains `* * * * *`.
- `APP_MASTER_KEY` exists as a Cloudflare secret and has not changed unexpectedly.
- Telegram bot token/webhook secret and provider secrets are available through encrypted secure settings or the approved migration fallback.
- System diagnostics report the expected runtime and secure-setting migration state.
- If legacy ENV cleanup is planned, first capture the authenticated System API snapshot and run `npm run config:finalize -- <snapshot.json>` as a dry-run. Use `--write` only after reviewing the plan.

### Required Telegram membership prerequisites

`@DRDNetwork` and `@DRDrate` are permanent required channels. Any owner-added extra channel is also enforced.

For Telegram `getChatMember` checks on other users to be reliable, the bot must be an **Administrator** in every required channel. Verify this in Telegram before deploying the membership gate.

The bot Owner intentionally bypasses membership enforcement to prevent administrative lockout.

## 3. Back up D1

Create a remote export immediately before deployment:

```bash
mkdir -p backups
npx wrangler d1 export drd-rate-manager-db --remote --output=./backups/drd-rate-manager-pre-release.sql
```

Keep the export outside source control. It may contain operational or user-related data.

Optionally record current database information:

```bash
npx wrangler d1 info drd-rate-manager-db --json
```

## 4. Deployment — manual approval only

Deployment is an explicit operator action. Do not add this command to `release:check` or an automatic patch script.

When the candidate, backup, configuration, and rollback plan are approved:

```bash
npx wrangler deploy
```

Record the resulting Worker version/deployment identifier and the Git commit SHA.

## 5. Post-deploy verification

Run these checks immediately after deployment.

### HTTP and API

- `GET /` returns the normal service root.
- `GET /docs` loads the self-contained API documentation.
- `GET /openapi.json` returns OpenAPI 3.1 metadata.
- Market endpoints follow the configured public/private Market API mode.
- Core endpoints still require a valid `drd_core_*` token.
- The private Web Admin path works and is not disclosed by public docs.

### Web Admin

- Login succeeds with the expected account.
- A successful login appears in Login Security history.
- Telegram Owner receives the successful-login security notification.
- Invalid login attempts are recorded without credential/session leakage.
- Admins, Sources, Assets, Automation, API Management, System and Login Security views load normally.

### Telegram

- `/id` remains available for onboarding.
- Owner can access the management panel even without channel membership.
- A regular Admin who is not in every required channel receives the join/recheck gate.
- After joining all required channels, `✅ Check membership` restores access.
- `@DRDNetwork` and `@DRDrate` cannot be removed.
- Owner-added extra channels can be added only when the bot is Administrator there.
- Login Security history is Owner-only.

### Automation and providers

- System status can be opened without triggering provider refreshes.
- Manual source refresh works.
- Market preview works.
- Automatic publishing diagnostics show the correct next slot/quiet-hours state.
- Do not force-publish to the production channel unless a real publication is intended.

### Database and security

- System diagnostics report schema **13**.
- D1 is connected and expected tables are present.
- Secure settings remain encrypted.
- No raw API token, Web Admin password, raw session, CSRF token, Telegram bot token, or Authorization header appears in logs/UI/history.

## 6. Rollback plan

If the deployment has a functional regression:

1. Stop manual changes and preserve logs/correlation IDs.
2. Roll back the Worker to the previously known-good deployment/version using the Cloudflare deployment controls appropriate to the account.
3. Do **not** import the D1 backup merely to roll back Worker code. Schema 13 changes are designed to be backward-compatible; database restore is a separate destructive decision.
4. If database restoration is genuinely required, review the exported SQL and Cloudflare D1 restore/import procedure before changing production data.
5. Re-run HTTP, Web Admin, Telegram membership, and automation smoke checks after rollback.

## 7. Release evidence to retain

Keep these with the release notes or deployment record:

- Git commit SHA.
- `npm run release:check` result.
- Clean `git status` result.
- D1 export filename and timestamp.
- Pre-deploy System health/migration snapshot.
- Cloudflare deployment/version identifier.
- Post-deploy smoke-test result.

Do not retain raw production secrets, session cookies, CSRF tokens, or raw API tokens in release evidence.
