import { registerPredicate } from './conditions.js';
import type { SystemNotice } from './types.js';

/**
 * Registered at module load, unchanged from before this plan (Plan 3f Task
 * 6/R1's adopted wiring): the closure used to read `app_settings` directly
 * through the raw `db` handle here; now it only reads a value the caller
 * (`SystemNoticesService.getActiveFor`) already resolved into `ctx` before
 * `evaluate()` runs, the same shape `addonEnabled`/`managed` already use.
 * `evaluateOne`'s `case 'custom'` (`conditions.ts`) calls this synchronously
 * inside a `.filter()`, which cannot `await` — moving the DB read into this
 * closure directly would either need to make the closure (and the whole
 * evaluate/evaluateOne chain) async, or read an un-awaited repository
 * result. Reading a pre-resolved value off `ctx` avoids both, stays
 * race-free (the value flows through the per-call `ctx` object, not shared
 * mutable state on a singleton), and needs no Nest lifecycle hook — this
 * registration stays exactly where it always was.
 */
registerPredicate('whitespace-collision-detected', (ctx) => ctx.settingFlag('whitespace_migration_collision'));

/**
 * SYSTEM NOTICE REGISTRY
 *
 * Rules for authoring:
 * - NEVER reuse a retired `id` — dismissal tracking is keyed by `id`. Retired ids are
 *   listed in RETIRED_NOTICE_IDS so they're never accidentally re-used.
 * - `id` must be globally unique and stable across deployments.
 * - Title: ≤40 chars, sentence case, no trailing punctuation.
 * - Body: markdown (modal) or plain text (banner/toast). ≤400/140/80 chars.
 * - CTA label: ≤20 chars.
 * - Never hardcode version numbers/dates in translated strings — use bodyParams.
 */

/**
 * Retired notices. Kept out of the active list but their ids stay reserved so a future
 * notice never reuses one (dismissals are keyed by id). Do not re-add these ids.
 */
export const RETIRED_NOTICE_IDS = [
  'v3-thankyou',
  'v3-photos',
  'v3-journey',
  'v3-mcp',
  'v3-features',
  'welcome-v1',
  'release-4-0-0',
  'release-notes',
  'thank-you-support',
] as const;

export const SYSTEM_NOTICES: SystemNotice[] = [
  // ── 3.0.14 admin notice — whitespace migration collision ───────────────────
  // Operational alert (not promo): shown only to admins who upgraded across the
  // 3.0.14 boundary AND only when the migration actually renamed colliding accounts.
  {
    id: 'v3014-whitespace-collision',
    display: 'banner',
    severity: 'warn',
    icon: 'AlertTriangle',
    titleKey: 'system_notice.v3014_whitespace_collision.title',
    bodyKey: 'system_notice.v3014_whitespace_collision.body',
    dismissible: true,
    conditions: [
      { kind: 'existingUserBeforeVersion', version: '3.0.14' },
      { kind: 'role', roles: ['admin'] },
      { kind: 'custom', id: 'whitespace-collision-detected' },
      // The body says to check the server logs. On a managed install the reader
      // has none, and the operator sees the same collision in theirs.
      { kind: 'managed', is: false },
    ],
    publishedAt: '2026-05-03T00:00:00Z',
    priority: 85,
    minVersion: '3.0.14',
  },
];
