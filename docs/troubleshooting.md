# Troubleshooting

## Provider test fails

Check:

1. source is enabled;
2. managed endpoint is valid;
3. provider-specific response format has not changed;
4. HTTP status/latency/message in source status;
5. circuit/cooldown state;
6. Worker egress/network error;
7. normalization returns a positive price.

Do not change final consensus logic just to make one provider pass.

## Final USDT/gold price looks wrong

Inspect:

```text
contributors
rejected
sampleCount
strategy
```

Confirm the 3% outlier rule and provider-unit conversions.

Remember: source order is not a primary/fallback route.

## No healthy providers

If every enabled source fails, consensus fails.

Check provider status individually and use targeted source tests before forcing a full market refresh.

## Market refresh fails but old data appears

This can be expected stale fallback behavior.

Inspect cache metadata:

```text
present
fresh
expired
age
last_error
```

If refresh coordination/lock storage fails and cache exists, the service may return stale cache. Without a usable cache it should fail closed.

## Web Admin login fails

Check:

- correct private path;
- bootstrap completion state;
- username normalization;
- password length/credential state;
- session cookie support;
- login-attempt lockout;
- credential version;
- `APP_MASTER_KEY` availability.

Do not log or paste the password/session cookie while troubleshooting.

## Login is locked

The current policy allows five failures in a 15-minute window and uses a 15-minute lock.

Use Login History to distinguish invalid credentials from active rate limiting.

## Web Admin page flashes or goes blank

Run the Playwright browser suite.

Check:

- session bootstrap endpoint;
- expired session handling;
- correct view ID mapping;
- private static asset availability;
- no-store behavior;
- browser console/network errors.

## Configuration update rejected

Validate the central runtime rule for that key.

Typical causes:

- invalid timezone;
- invalid provider URL/protocol;
- invalid Telegram ID/handle;
- invalid CoinGecko plan/top limit;
- invalid asset CSV;
- out-of-range database limit.

## Secret replacement rejected

Secret mutations require:

- authenticated Web Admin session;
- valid CSRF;
- current-password confirmation;
- configured `APP_MASTER_KEY`;
- known managed secure-setting key.

Existing plaintext is intentionally unavailable.

## Runtime diagnostics show legacy fallback

Do not remove the corresponding ENV input.

First populate/repair the D1 runtime value, refresh the exact candidate, then re-check migration readiness.

## Secure diagnostics show legacy fallback/missing

Do not delete the Worker secret.

Verify encrypted `secure_settings` rows and `APP_MASTER_KEY`.

## runtime_settings_version changes between 2 and 3

This indicates mixed-version execution against shared D1 where an older production Worker still writes catalog metadata.

Use exact candidate/version-specific smoke. After final promotion, verify the version stabilizes.

Future metadata writes should be made monotonic/downgrade-safe.

## API returns 401

Check:

- Bearer token exists;
- token prefix matches endpoint audience;
- token is enabled;
- token is not revoked;
- token is not expired;
- stored hash matches.

## API returns 403 wrong_scope

A valid Market token was used on a Core endpoint or vice versa. Create/use the correct isolated token type.

## Automation does not publish

Check:

- bot enabled;
- automation enabled;
- current quiet-hours state;
- next aligned slot;
- retry/already-published state;
- distributed lock;
- market quality;
- Telegram channel configuration;
- last automation error/history.

## Duplicate publish suspected

Inspect `runtime_locks`, aligned slot state, and `automation_runs`.

Do not bypass locks in production as a first response.

## D1 query/operation fails

Check D1 binding/config, database availability, and schema bootstrap.

A repository failure can have different semantics depending on the subsystem: security/auth decisions should fail closed, while selected history/telemetry writes can fail open by design.

## Release preflight says dirty tree

During active work, this is expected.

Before final release, review all changes and require a clean tree.

## PowerShell cannot run npm.ps1

Use:

```powershell
npm.cmd run <script>
```

This avoids changing machine-wide PowerShell Execution Policy.

## Related documents

- [Providers](providers.md)
- [Web Admin](web-admin.md)
- [Development](development.md)
- [Deployment](deployment.md)
