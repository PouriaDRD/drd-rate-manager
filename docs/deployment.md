# Deployment and Staged Rollout

## Principle

Deployment is an explicit operator action. Local test commands do not deploy.

Final production deployment must originate from `main`.

## Pre-release sequence

```text
dev implementation
→ tests / syntax / format / preflight
→ fresh remote D1 backup
→ candidate upload
→ zero-percent staged deployment
→ version-specific smoke
→ final release gate
→ merge dev -> main
→ upload/promote production candidate from main
→ post-deploy verification
→ post-promotion cleanup
```

## Candidate upload

Use an explicitly pinned Wrangler version used by the project/operator environment.

Example:

```bash
npx --yes wrangler@<PINNED_VERSION> versions upload \
  --config <PRODUCTION_WRANGLER_FILE> \
  --message "<RELEASE_CANDIDATE_MESSAGE>"
```

Uploading a version does not itself move production traffic.

## Zero-percent staged deployment

Keep the current production version at 100% and the candidate at 0%.

Example pattern:

```bash
npx --yes wrangler@<PINNED_VERSION> versions deploy \
  <CURRENT_VERSION>@100% \
  <CANDIDATE_VERSION>@0% \
  --config <PRODUCTION_WRANGLER_FILE> \
  --message "<SMOKE_MESSAGE>" -y
```

Verify the resulting deployment before version-specific smoke.

## Version-specific smoke

Where Cloudflare version override is available, call the candidate explicitly rather than moving live traffic.

Check at minimum:

- root/version;
- authenticated private System snapshot;
- runtime settings readiness;
- secure settings readiness;
- provider/configuration resolution;
- docs/OpenAPI where relevant;
- browser/private control-plane behavior where relevant.

Avoid manual publish/force-run unless a real production publication is intended.

## Configuration-migration release

For a release that removes legacy ENV inputs:

1. prove same-code readiness;
2. run configuration finalizer dry-run;
3. review;
4. write the cleaned private Wrangler config;
5. upload a new candidate from that cleaned config;
6. smoke the cleaned candidate at 0%;
7. keep legacy Worker secrets until the new release is production;
8. promote the final candidate only after merge to `main`;
9. verify post-promotion metadata and secure/runtime readiness;
10. only then delete approved legacy Worker secrets;
11. never delete `APP_MASTER_KEY`.

## Version skew

Zero-percent deployment still means old and new versions coexist in the deployment definition, and version-specific requests can execute the candidate against the shared D1 database.

Do not interpret D1 catalog metadata from an arbitrary request as proof of candidate readiness unless the exact code version is known.

## Production promotion

Do not promote a `dev`-branch upload as the final production release.

After all candidate gates pass:

```text
dev -> main
```

Then build/upload the release version from `main`, verify commit/version identity, and perform the approved production promotion.

## Rollback

Before promotion, retain:

- previous known-good Worker Version ID;
- previous Git commit/tag;
- fresh D1 backup;
- rollback decision criteria.

If the code release regresses, roll Worker traffic back to the known-good version.

Do not restore D1 merely because Worker code was rolled back.

## Legacy Worker secrets

Legacy secure Worker secrets are post-promotion cleanup items after the new version is verified using encrypted D1 secure settings.

Only remove explicitly approved legacy secrets. `APP_MASTER_KEY` remains.

## Related documents

- [Release checklist](release-checklist.md)
- [Configuration](configuration.md)
- [Database](database.md)
