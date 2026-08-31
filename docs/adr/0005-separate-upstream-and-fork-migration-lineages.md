---
status: accepted
---

# Separate upstream and fork migration lineages

TREK keeps `schema_version` aligned with the official upstream numeric migration chain and records downstream schema work by stable name in `fork_schema_migrations`. The released fork had already assigned different meanings to upstream slots 199–200, so continuing one positional sequence would recreate the collision on every later upstream migration. During the v4.1.1 upgrade, only a database whose version and artifacts prove that legacy fork lineage is normalized from 199–202 to upstream 200; the missing upstream additions are installed transactionally, all user data remains in place, and the four idempotent fork migrations then reconcile and record their own state. Ambiguous newer schemas are rejected rather than guessed.
