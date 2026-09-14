# Upstream Fork Upgrade Playbook

Read this reference when planning, rehearsing, or implementing an upstream upgrade. Adapt branch names and commands to the repository; examples use `origin` for the fork and `upstream` for the source project.

## 1. Preflight and release identity

Inspect before mutating:

```bash
git status --short --branch
git remote -v
git branch -vv
git tag --list
```

If the upstream remote is missing, add it only when implementation is authorized. Resolve the user-selected release, or the latest stable release when none is selected, from the official release feed. Exclude prereleases unless requested and pin the full peeled commit SHA.

Record:

- upstream tag and peeled commit;
- upstream release notes and known upgrade warnings;
- downstream branch tips and current upstream baseline;
- root/core/SDK versions;
- upstream and fork schema endpoints;
- branches or environments that automatically deploy.

Verify the tag or release commit using the mechanisms the upstream project publishes. An unsigned tag, annotated or lightweight, may still point to a signed commit. Record tag and commit signature status separately from official release-page provenance. When the user accepts an unsigned release, record that exception and its fixed SHA rather than claiming signature verification.

## 2. Baseline validation

Create an isolated baseline checkout from the exact tag. Do not run the baseline in a directory containing downstream modifications.

Run the upstream-documented install, build, tests, type checks, and production container build. Record failures without “fixing” upstream during baseline validation. The baseline result is the control for later comparison.

## 3. Customization inventory

Use several views; no single diff is sufficient:

```bash
git log --oneline --decorate <old-upstream-tag>..<fork-tip>
git diff --stat <old-upstream-tag>..<fork-tip>
git diff --name-status <old-upstream-tag>..<fork-tip>
```

Also inspect repository ADRs, domain/context docs, APIs, migrations, settings, event schemas, plugins, MCP/RPC surfaces, localization, responsive UI, deployment files, and regression tests.

Maintain a table like:

| Capability | Contract | Upstream change | Disposition | Proof |
|---|---|---|---|---|
| Example | Route/data/UI semantics | Replaced service | Adapt | Tests + backup rehearsal |

List retired and superseded changes as deliberately as retained ones. This prevents obsolete code from returning in future syncs.

## 4. Conflict and overlap rehearsal

For read-only assessment or planning, use `git merge-tree --write-tree --name-only <fork-tip> <pinned-upstream-commit>` in an isolated object cache. Its output tree is diagnostic only and may contain conflict markers; never promote it as an audited result.

For authorized implementation, use an isolated worktree and attempt the exact tag merge without committing. Never rehearse against the user's active dirty tree. Capture:

- total conflict records and unique paths;
- content, add/add, rename, and modify/delete conflicts;
- cleanly merged files that still overlap customized subsystems;
- migrations, routes, authentication, settings, generated interfaces, locale overlays, and deployment files.

Abort or discard only the disposable rehearsal state. Compare the observed surface with the strategy criteria in `SKILL.md`.

Do not report only “N conflicts.” Explain which contracts are endangered and whether upstream deleted or replaced the downstream implementation seam.

## 5. Strategy decision

### Incremental release-tag merge

Choose when:

- the previous upstream baseline is known;
- migration numbering has one meaning;
- no customized subsystem was wholesale replaced;
- conflict resolution is localized;
- regression tests cover the overlaps.

Merge the stable tag, resolve in favor of current upstream architecture plus retained contracts, then run the full verification matrix.

### Release-baseline port

Choose when architecture, migrations, or conflict volume make a merge misleading.

1. Branch from the exact upstream release tag.
2. Validate the untouched baseline.
3. Port shared contracts and schemas first.
4. Port server/domain behavior into upstream's modules.
5. Port desktop/mobile UI and localization.
6. Integrate plugin, MCP, public API, worker, and deployment seams.
7. Add migrations/audit tooling and documentation.
8. Verify the completed tree before connecting histories.

Keep upstream features authoritative unless the customization inventory records a deliberate override.

## 6. Database lineage design

Build a schema-classification matrix containing at least:

- fresh database;
- last clean pre-upgrade upstream schema;
- every supported downstream custom version;
- previous upstream release schema;
- every partial new-upstream schema that may exist after interruption;
- every legacy fork partial version;
- ambiguous/mixed negative cases;
- a restored production backup;
- repeated/idempotent execution.

For each classification, define the artifacts that must exist and those that must not. Metadata alone is insufficient when numbers were reused. Fixtures must reproduce the actual old schema, including absent later artifacts; merely lowering the version number on a fresh current database can hide skipped migrations.

When separating lineages:

- upstream numeric version tracks only upstream migrations;
- fork migrations use a dedicated table with stable string IDs and applied timestamps;
- legacy normalization installs missing upstream artifacts idempotently, preserves custom tables/data, and changes metadata only after marker validation; its historical endpoint stays fixed even when the current upstream migration endpoint advances, so later official migrations are not skipped;
- named fork migrations reconcile final state and record completion transactionally.

Audit output should include classification, upstream version, fork IDs, missing official/custom artifacts, integrity result, foreign-key failures, and preservation counts. Keep it read-only and independent of normal auto-migration bootstrap.

## 7. Contract-focused verification

Test the upstream additions and every retained customization, with special focus on overlapping paths.

Typical gates:

- shared/server/client complete suites and configured coverage thresholds;
- type, lint, format, generated-contract, and locale-parity checks;
- targeted desktop/mobile browser regressions;
- public API, MCP, plugin, event, permission, and worker contracts;
- production build and container health/config smoke test;
- separate SDK install/build/test cycle;
- migration matrix and restored-backup rehearsal;
- application smoke tests against a private staging restore.

Do not lower a coverage ratchet to land the upgrade. Add tests for the ported domain or document a pre-existing repository-wide advisory separately.

## 8. History bridge and immutable identity

Create safety tags before changing long-lived branches. After the port commit is complete, record the tree:

```bash
git rev-parse HEAD^{tree}
```

If the new baseline history must connect to the old fork history:

```bash
git merge -s ours --no-ff <pre-upgrade-safety-tag> -m "chore: bridge pre-upgrade history"
git rev-parse HEAD^{tree}
git diff --exit-code HEAD^1 HEAD
```

The before/after tree hashes must match. If they do not, stop.

Create the immutable fork release tag only after the final audited commit—including release/CI identity fixes—is stable. Ensure any public source-code URL names that exact tag or commit.

## 9. Promotion

Use the repository's normal PR flow. After each merge, fetch and compare trees:

```bash
git rev-parse <source-tag>^{tree}
git rev-parse origin/<promoted-branch>^{tree}
git diff --exit-code <source-tag>^{tree} origin/<promoted-branch>^{tree}
```

GitHub merge commits may differ while tree hashes remain identical.

Before assuming no extra bridge is needed, prove ancestry with `git merge-base --is-ancestor`. If a long-lived branch diverged, inspect its unique commits and tree diff, reconcile any retained work, and re-test before creating a dedicated promotion branch. Only then may an `ours` bridge connect its history. Tree equality alone does not establish that its unique behavior was preserved.

Inspect GitHub deployment objects or the hosting provider before merging a high branch. Environment labels, branch names, and hostnames can disagree about whether a deployment is production.

## 10. Production rollout and rollback

These are rollout gates, not prerequisites for completing an assessment or tested PR. If production evidence or a backup is unavailable, finish independent authorized work and clearly mark the uncompleted production rehearsal; do not represent the PR as deployment-ready.

Before production:

1. Confirm live plugin compatibility and current configuration.
2. Stop writes and checkpoint the database.
3. Take a fresh complete offline backup: database, uploads, encryption material, plugin data, and configuration.
4. Preserve the old image/ref needed for rollback.
5. Deploy the exact immutable source tag/tree.
6. Run migrations and the read-only audit before reopening writes.
7. Smoke-test authentication, primary data views, customized workflows, integrations, mobile behavior, and notifications.
8. Reopen traffic only after checks pass.

If rollback is required, stop the new service and restore both the old image and the complete pre-upgrade backup. Do not boot the old binary against the upgraded database.

## 11. Handoff record

Report:

- exact upstream and fork source identities;
- integration strategy and why;
- conflict/overlap audit;
- retained, adapted, superseded, retired, and unresolved customizations;
- database classifications and rehearsal evidence;
- test/build/container results;
- pre/post-bridge and promotion tree hashes;
- PRs, tags, and deployment destinations;
- backup/rollback status;
- advisory findings intentionally deferred.
