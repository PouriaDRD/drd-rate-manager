# Changelog

All notable changes to DRD Rate Manager are documented in this file.

The project follows semantic versioning for application releases. Database schema, runtime-settings catalog, and secure-settings catalog versions are tracked independently.

## [0.2.1]

### Added

- Full Web Admin configuration management for all 25 managed runtime settings.
- Replace-only management for all 4 encrypted secure settings without returning plaintext values.
- Provider and CoinGecko connectivity testing from the private configuration surface.
- Playwright browser E2E coverage for Chromium, Firefox, and WebKit.
- Complete Persian and English project manuals plus specialist operator/developer documentation.
- Dedicated release-hygiene regression coverage for version tooling.

### Changed

- Runtime Settings Catalog advanced to version `3`; D1 remains the source of truth after migration.
- Version bump tooling is explicit-allowlist based, dry-run by default, and updates current-release assertions without rewriting historical fixtures.
- Release preflight reports the actual Wrangler `APP_VERSION` when it differs from the expected application version.
- Web Admin session-expiry handling, view activation, configuration workflows, and responsive navigation were hardened.
- Telegram command/input routing was hardened so ordinary text and unknown slash commands do not accidentally open menus or consume unrelated pending flows.
- Project documentation now reflects the current multi-provider consensus architecture and release workflow.

### Fixed

- Market refresh-lock storage failures can serve a usable stale cache instead of replacing availability with an internal failure.
- Cache-write failure after a successful live refresh can fall back to the previous usable snapshot.
- Expired or credential-version-mismatched Web Admin sessions are rejected and invalidated consistently.
- Invalid CSRF no longer deletes an otherwise valid session.
- Failed runtime/secure configuration persistence no longer emits a false-success audit event.
- Automation-history persistence failures no longer replace the primary publish outcome.

### Release invariants

- Application version: `0.2.1`
- Public API version: `v1`
- D1 schema: `13`
- Runtime Settings Catalog: `3`
- Secure Settings Catalog: `1`
- No destructive D1 schema migration is introduced by this release.
- `APP_MASTER_KEY` remains a permanent Worker secret and must not be regenerated or removed during release cleanup.

See [`docs/releases/v0.2.1.md`](docs/releases/v0.2.1.md) for the release-candidate operator notes.
