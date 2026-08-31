# Upstream Release Sync

`origin` is the downstream fork and `upstream` is `https://github.com/liketrek/TREK.git`. Upgrade from signed/stable release tags, never from upstream `dev`.

## Release-baseline workflow

1. Fetch and verify the requested upstream tag and record the current fork tips with `pre-vX/` safety tags.
2. Create `codex/upgrade-trek-vX` from the tag and run the unmodified upstream baseline tests.
3. Port the customization inventory below by contract and regression test; do not replay historical implementation commits.
4. Rehearse database migration on a restored production backup and run the read-only upgrade audit.
5. After verification, merge the preserved old tips with the `ours` strategy and verify the tree hash did not change. Target `dev`, then promote through the normal release/main flow.

v4.1.1 is the current baseline (`33a33e7`). Once it is adopted, compatible signed 4.x tags use an incremental release-tag merge from the last adopted tag. Return to this baseline workflow for a major version, an upstream migration-lineage change, a delete/replace conflict in a customized subsystem, or a merge whose behavior cannot be proven by the customization regressions. Always rehearse the merge first and record exact conflict and overlapping-path counts.

## Customization inventory

- Layered frozen exchange rates with provenance across REST, MCP, plugins, desktop, and mobile.
- Ordered Common currency shortcuts with administrator inheritance and personal empty/reset semantics.
- Guest identity transfer and the New-member identity check.
- TREK-managed Direct Web Push.
- Exact departure-transport countdown on desktop and mobile spotlights.
- Mobile trip day selection recovers after reload, a cleared selection, or a stale day id by choosing the closest valid focus day.
- Traditional Chinese wording overlay and `zh-HK` detection.
- Debranded Help/About/release promotion with a neutral AGPL Legal/Source page.
- Docker builder stages explicitly include development dependencies.
- Fork CI runs the S3 contract against pinned community MinIO so it does not depend on upstream's proprietary AIStor license secret.

Superseded: the Mapbox reservation-source teardown patch, which is already present upstream v4.

## Migration lineages

The old fork used migrations 176–180 for different schemas than upstream v4, then used 199–202 while upstream v4.1 assigned 199–200 to other changes. `schema_version` now tracks only the official upstream chain; named rows in `fork_schema_migrations` track the crosswalk, enhanced FX, Guest identity, and Web Push schemas. The v4.1.1 preflight translates only verified legacy fork versions and rejects mixed or unknown histories.

Never boot an unmodified upstream image against a fork database. Rehearse with `npm run audit:v4-upgrade --workspace=server -- --db <copy>` before and after migration, and roll back only by restoring the complete pre-upgrade database, uploads, encryption material, plugin data, configuration, and old image.
