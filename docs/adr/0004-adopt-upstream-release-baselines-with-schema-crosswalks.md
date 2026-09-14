---
status: accepted
---

# Adopt upstream release baselines with schema crosswalks

TREK's downstream fork starts each major upgrade, and any high-risk minor upgrade, from the exact upstream release tag. It ports the documented customization inventory onto that tree and then bridges the old fork tip into history without changing the audited release-based tree. This avoids resolving obsolete implementations after upstream architectural rewrites, at the cost of deliberate capability ports and an explicit history bridge.

After v4.1.1 is adopted, compatible official stable 4.x release tags are merged incrementally. Record cryptographic signature status separately from official release provenance. For an unsigned release, record explicit user acceptance and pin the full commit SHA; v4.2.1 is accepted on that basis at `515398f8ee3000b36a5f5b80365d6214f3f1a723`. A release returns to the baseline-port workflow when it changes migration lineage, deletes or replaces a customized subsystem, crosses a major-version boundary, or cannot preserve the customization contracts through an auditable merge. Development branches are never upgrade baselines.

Because the 3.4.1 fork and upstream v4 independently used numeric migration slots 176–180, and the released v4 fork later collided with upstream slots 199–200, numeric schema history is no longer used for downstream features. ADR 0005 records the independent migration lineages that let clean upstream, partially upgraded, and previously customized databases converge.
