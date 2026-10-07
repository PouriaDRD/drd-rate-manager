# Development and Testing

## Branch policy

```text
dev  = development/testing/commit/push
main = production-only
```

Do not perform routine feature development directly on `main`.

## Install

```bash
git clone https://github.com/PouriaDRD/drd-rate-manager.git
cd drd-rate-manager
git checkout dev
npm install
```

For reproducible environments:

```bash
npm ci
```

## Main scripts

```bash
npm test
npm run check:syntax
npm run format:check
npm run check

npm run test:phase19.8
npm run test:browser
npm run test:browser:chromium
npm run test:browser:headed
npm run test:hardening

npm run release:preflight
npm run release:check
```

`release:check` does not deploy.

## Browser testing

Playwright is pinned to `1.63.0`.

Mandatory browser projects cover:

```text
Chromium
Firefox
WebKit
```

Browser tests focus on Web Admin behavior and use deterministic mocked API flows where appropriate.

## Test philosophy

A fixed production/release bug should gain a permanent regression test.

Coverage should include:

- happy path;
- failure path;
- boundary/edge cases;
- security rejection;
- persistence behavior;
- concurrency where relevant;
- browser behavior for UI regressions.

## Phase 19.8 hardening

The hardening matrix is documented in [phase19.8-test-matrix.md](phase19.8-test-matrix.md).

It covers configuration, provider consensus, browser flows, API tokens, Telegram input state, CSRF/session security, D1 failures, cache/lock behavior, automation, and release smoke.

## Formatting

The repository uses Prettier and a format-stability check.

On Windows PowerShell, if local Execution Policy prevents `npm.ps1`, use:

```powershell
npm.cmd run format:check
npm.cmd test
```

Do not change machine-wide Execution Policy merely to run project scripts.

## Release preflight

Repository-only:

```bash
npm run release:preflight
```

Strict production config:

```bash
npm run release:preflight -- --strict-config --wrangler <PRODUCTION_WRANGLER_FILE> --require-clean
```

During intentional uncommitted documentation/code work, omit `--require-clean` until the change is ready for the final clean-tree gate.

## Test evidence

Before a release candidate, retain exact counts/results for:

- Node tests;
- browser tests;
- syntax checks;
- format checks;
- preflight;
- working tree state.

Do not describe a gate as green without actual output.

## Related documents

- [Release checklist](release-checklist.md)
- [Deployment](deployment.md)
