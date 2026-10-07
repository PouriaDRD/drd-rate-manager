# DRD Rate Manager Release Checklist

This checklist separates candidate validation, staged smoke, final `dev -> main` promotion, and post-promotion cleanup.

Nothing in `npm run release:check` deploys the Worker or mutates Cloudflare resources.

## 1. Candidate validation on dev

Confirm:

```bash
git branch --show-current
git status --short
git log -1 --oneline
```

Expected development branch:

```text
dev
```

Run:

```bash
npm test
npm run check
npm run test:browser
npm run release:check
```

For the actual production Wrangler file:

```bash
npm run release:preflight -- \
  --strict-config \
  --wrangler <PRODUCTION_WRANGLER_FILE> \
  --require-clean
```

Record exact test counts/results. A mandatory failing suite blocks release.

## 2. Production prerequisites

Verify:

- D1 `DB` binding points to the intended database.
- `ASSETS` points to `./public/admin` with `run_worker_first`.
- Cron is `* * * * *`.
- `APP_NAME`/`APP_VERSION` are correct.
- `APP_MASTER_KEY` exists and has not been regenerated.
- Runtime settings diagnostics are expected for the release.
- Secure settings diagnostics are expected for the release.
- Required Telegram channels are exactly `@DRDNetwork` and `@DRDrate`.
- Membership verification uses Telegram `getChatMember`.
- The bot is Administrator where required for membership checks.
- Owner intentionally bypasses membership enforcement to prevent administrative lockout.
- Rollback Worker version is known.

Never commit the real production Wrangler file if it contains environment-specific identifiers.

## 3. Fresh D1 backup

Immediately before the release candidate/promotion window:

```bash
npx --yes wrangler@<PINNED_VERSION> d1 export \
  <DATABASE_NAME> \
  --remote \
  --config <PRODUCTION_WRANGLER_FILE> \
  --output=./backups/pre-release.sql
```

Store backup outside Git.

Record timestamp and file size.

The repository's established database-name example is intentionally kept explicit for release-contract validation:

```bash
npx wrangler d1 export drd-rate-manager-db --remote --config <PRODUCTION_WRANGLER_FILE> --output=./backups/pre-release.sql
```

## 4. Upload release candidate

Upload only:

```bash
npx --yes wrangler@<PINNED_VERSION> versions upload \
  --config <PRODUCTION_WRANGLER_FILE> \
  --message "<RC_MESSAGE>"
```

Record the candidate Version ID.

Upload is not approval for production traffic.

## 5. Zero-percent staged deployment

With explicit approval, deploy:

```text
known-good production version = 100%
candidate version             = 0%
```

Example:

```bash
npx --yes wrangler@<PINNED_VERSION> versions deploy \
  <CURRENT_VERSION>@100% \
  <CANDIDATE_VERSION>@0% \
  --config <PRODUCTION_WRANGLER_FILE> \
  --message "<ZERO_PERCENT_SMOKE_MESSAGE>" -y
```

Then verify:

```bash
npx --yes wrangler@<PINNED_VERSION> deployments list \
  --config <PRODUCTION_WRANGLER_FILE>
```

Do not continue if the split is not exactly the approved split.

### Deployment — manual approval only

Deployment is always a manual, explicitly approved action. `npm run release:check` and `release:preflight` never deploy.

The preferred production flow for this project is the versioned rollout described above and a final release built from `main`.
The generic `npx wrangler deploy` command is deployment-capable and must **not** be used during validation, documentation checks, or ordinary `dev` work. If it is ever deliberately chosen for a production release, it may only be run from the reviewed `main` state after explicit deployment approval and with the intended production config.

## 6. Candidate smoke

Use version-specific routing/override where supported.

Validate:

- `GET /` returns expected application version.
- `/docs` and `/openapi.json` are healthy.
- authenticated private Web Admin login/session works.
- System diagnostics are healthy.
- Runtime settings are fully D1-owned as expected.
- Secure settings are encrypted/migrated as expected.
- provider/source configuration resolves correctly.
- Market snapshot works without unsafe partial publication.
- Web Admin main views work.
- Login History/API Management/Configuration views work.
- Telegram non-destructive management flow works.

Avoid force-run/manual production publish unless intentionally testing a real publication.

## 7. Configuration-cleanup releases

When legacy ENV cleanup is part of the release:

1. capture a fresh authenticated candidate System snapshot;
2. run `config:finalize` dry-run;
3. review the exact removal plan;
4. run `--write` only on the intended private Wrangler file;
5. verify legacy runtime vars are gone;
6. upload a fresh clean-config candidate;
7. repeat zero-percent candidate smoke;
8. keep legacy Worker secrets until post-promotion.

`APP_MASTER_KEY` is always retained.

## 8. Final gate before merge

Run the full release gate again after all release-related changes.

Require:

```text
all mandatory Node tests green
all browser projects green
syntax green
format green
strict preflight green
working tree clean
fresh backup retained
rollback target retained
candidate smoke green
```

## 9. Merge dev -> main

Only after explicit release approval:

```bash
git checkout main
git pull
git merge --ff-only dev
```

If fast-forward is not possible, stop and review branch history instead of improvising a merge.

Push `main` only after verifying the intended commit.

## 10. Production version from main

The final production release must be built/uploaded from `main`, not by promoting an arbitrary earlier `dev` upload.

Upload from `main`, verify commit/version identity, then perform the approved production traffic promotion.

Record:

```text
Git SHA
tag/release version
Cloudflare Worker Version ID
previous rollback Version ID
```

## 11. Post-deploy verification

Immediately verify:

### HTTP/API

- root/version;
- docs/OpenAPI;
- Market public/private mode;
- Core token enforcement;
- private path not exposed.

### Web Admin

- login/session;
- dashboard;
- Sources;
- Assets;
- Automation;
- API Management;
- System;
- Login History;
- Configuration.

### Telegram

- `/id`;
- Owner control-plane access;
- regular Admin membership gate;
- immutable required channels;
- safe menu navigation.

### Market/automation

- provider status;
- USDT consensus;
- Gold consensus;
- CoinGecko;
- cache state;
- automation diagnostics.

### Security/database

- schema `13`;
- expected runtime/secure catalog versions;
- encrypted secure settings;
- no secret leakage in UI/logs/history.

## 12. Post-promotion legacy secret cleanup

The cleaned v0.2.1 production baseline has already completed this step. Its expected Worker secret inventory is `APP_MASTER_KEY` only.

For an older installation or a future migration that still carries legacy Worker secrets, only after the new production version is verified and stable:

- re-check exact production System readiness;
- verify runtime catalog metadata is stable;
- remove only the approved legacy Worker secrets;
- use version-aware Cloudflare secret operations when required by the deployment model;
- verify the Worker again after each cleanup batch;
- verify the final Worker secret inventory and ensure deleted legacy secrets were not reintroduced.

Never delete:

```text
APP_MASTER_KEY
```

## 13. Rollback plan

If a functional regression appears:

1. stop additional mutations;
2. preserve logs/correlation evidence;
3. move Worker traffic back to the known-good version;
4. do not restore D1 just because code was rolled back;
5. re-run HTTP/Web Admin/Telegram/automation smoke;
6. investigate migration compatibility before any database restore.

## 14. Evidence to retain

Keep:

- release Git SHA;
- tag/version;
- exact test outputs/counts;
- strict preflight;
- clean `git status`;
- D1 backup filename/timestamp/size;
- candidate System readiness snapshot metadata;
- candidate Worker Version ID;
- final Worker Version ID;
- rollback Version ID;
- zero-percent deployment proof;
- post-deploy smoke result;
- post-promotion cleanup result.

Do not retain plaintext secrets, raw API tokens, cookies, CSRF tokens, or passwords in release evidence.
