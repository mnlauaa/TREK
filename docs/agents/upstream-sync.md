# Upstream Release Sync

`origin` is the downstream fork and `upstream` is `https://github.com/liketrek/TREK.git`. Upgrade from official stable release tags, never from upstream `dev`. Record tag and commit signatures separately from release provenance. An unsigned release requires a recorded user acceptance and a pinned full commit SHA.

## Release-baseline workflow

1. Fetch and verify the requested upstream tag and record the current fork tips with `pre-vX/` safety tags.
2. Create `codex/upgrade-trek-vX` from the tag and run the unmodified upstream baseline tests.
3. Port the customization inventory below by contract and regression test; do not replay historical implementation commits.
4. Rehearse database migration on a restored production backup and run the read-only upgrade audit.
5. After verification and reconciliation of every unique downstream change, bridge the preserved old tips with the `ours` strategy only when necessary, and verify the tree hash did not change. Target `dev`; branch promotion and deployment are separately authorized actions.

v4.2.1 is this branch's upstream baseline (`515398f8ee3000b36a5f5b80365d6214f3f1a723`), merged incrementally from v4.1.1 (`33a33e7`). Both the v4.2.1 tag and commit are unsigned; the user accepted the official release pinned to that SHA. Compatible 4.x tags use an incremental release-tag merge from the last adopted tag. Return to the baseline-port workflow for a major version, an upstream migration-lineage change, a delete/replace conflict in a customized subsystem, or a merge whose behavior cannot be proven by the customization regressions. Always rehearse the merge first and record exact conflict and overlapping-path counts. See [the v4.2.1 evidence ledger](upgrades/v4.2.1.md).

## Customization inventory

- Layered frozen exchange rates with provenance across REST, MCP, plugins, desktop, and mobile.
- Ordered Common currency shortcuts with administrator inheritance and personal empty/reset semantics.
- Guest identity transfer and the New-member identity check.
- TREK-managed Direct Web Push.
- Exact departure-transport countdown on desktop and mobile spotlights.
- Mobile timeline day selection recovers after reload, a cleared selection, or a stale day id. The map permits an intentional All days selection; returning to the timeline restores the previous valid day or the closest valid focus day.
- Recorded mobile payments use the upstream date-grouped ledger with frozen FX and the fork's edit/delete actions.
- Traditional Chinese wording overlay and `zh-HK` detection.
- Debranded Help/About/release promotion with a neutral AGPL Legal/Source page.
- Docker builder stages explicitly include development dependencies.
- Fork CI runs the S3 contract against pinned community MinIO so it does not depend on upstream's proprietary AIStor license secret; Sonar upload is gated by `SONAR_ENABLED` and uses the fork-owned project and token.

Superseded: the Mapbox reservation-source teardown patch, which is already present upstream v4.

## Migration lineages

The old fork used migrations 176–180 for different schemas than upstream v4, then used 199–202 while upstream v4.1 assigned 199–200 to other changes. `schema_version` now tracks only the official upstream chain; named rows in `fork_schema_migrations` track the crosswalk, enhanced FX, Guest identity, and Web Push schemas. The historical normalization bridge still ends at 200. The official runner subsequently applies migrations 201–205; never normalize a legacy database directly to 205. Startup and the read-only audit share artifact-based lineage classification and reject mixed or unknown histories.

Never boot an unmodified upstream image against a fork database. Run `npm run audit:v4-upgrade --workspace=server -- --db <copy>` before migration and add `--require-current` afterward to require schema 205, all fork migrations, and clean integrity/foreign-key checks. Rehearse against an isolated restored backup. If no production backup is available, a tested PR can still be prepared, but production rehearsal remains a merge/deployment gate. Roll back only by restoring the complete pre-upgrade database, uploads, encryption material, plugin data, configuration, and old image.
