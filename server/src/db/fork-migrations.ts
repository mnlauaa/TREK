import type Database from 'better-sqlite3';

const LAST_V4_FORK_VERSION = 244;
export const LEGACY_FORK_BRIDGE_VERSION = 200;

export const FORK_SCHEMA_MIGRATION_IDS = [
  'fork/v4-schema-crosswalk',
  'fork/enhanced-fx-v1',
  'fork/guest-identity-v1',
  'fork/web-push-v1',
] as const;

export type ForkSchemaMigrationId = (typeof FORK_SCHEMA_MIGRATION_IDS)[number];

export const hasTable = (db: Database.Database, table: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

const hasColumn = (db: Database.Database, table: string, column: string): boolean =>
  hasTable(db, table) && !!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column);

const addColumn = (db: Database.Database, table: string, definition: string): void => {
  const column = definition.trim().split(/\s+/, 1)[0];
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
};

function ensureLedger(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fork_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function normalizeNumericFork(db: Database.Database): void {
  if (!hasTable(db, 'reservations') || !hasTable(db, 'mcp_tokens')) {
    throw new Error('Legacy fork schema is missing reservations or mcp_tokens; refusing version normalization.');
  }
  addColumn(db, 'reservations', "ingest_state TEXT NOT NULL DEFAULT 'live'");
  addColumn(db, 'mcp_tokens', "kind TEXT NOT NULL DEFAULT 'mcp'");
  db.prepare('UPDATE schema_version SET version = ?').run(LEGACY_FORK_BRIDGE_VERSION);
}

function hasCrosswalkArtifacts(db: Database.Database): boolean {
  return (
    hasColumn(db, 'vacay_entries', 'fraction') &&
    hasTable(db, 'vacay_shares') &&
    hasTable(db, 'place_ratings') &&
    hasTable(db, 'collection_place_ratings') &&
    hasColumn(db, 'day_assignments', 'leg_transport_mode') &&
    hasColumn(db, 'days', 'default_transport_mode') &&
    hasColumn(db, 'vacay_plans', 'school_holidays_enabled') &&
    hasColumn(db, 'vacay_holiday_calendars', 'type')
  );
}

function hasEnhancedFxArtifacts(db: Database.Database): boolean {
  return (
    hasTable(db, 'global_exchange_rate_snapshots') &&
    hasTable(db, 'trip_exchange_rates') &&
    hasTable(db, 'exchange_rate_batch_previews') &&
    ['budget_items', 'budget_settlements'].every((table) =>
      ['source', 'source_version', 'effective_date', 'set_at', 'set_by_user_id', 'note', 'reset_at'].every((field) =>
        hasColumn(db, table, `exchange_rate_${field}`),
      ),
    )
  );
}

function hasGuestIdentityArtifacts(db: Database.Database): boolean {
  return (
    hasColumn(db, 'trip_members', 'new_member_identity_check_completed_at') ||
    hasColumn(db, 'trip_members', 'guest_claim_prompted_at')
  );
}

function hasWebPushArtifacts(db: Database.Database): boolean {
  return [
    'id',
    'user_id',
    'installation_id',
    'endpoint_hash',
    'subscription_encrypted',
    'origin',
    'vapid_key_fingerprint',
    'label',
    'status',
    'created_at',
    'updated_at',
    'last_seen_at',
    'last_success_at',
    'last_error_at',
    'revoked_at',
  ].every((column) => hasColumn(db, 'web_push_subscriptions', column));
}

/** Structural markers of the official 4.3 chain, shared by startup and audit.
 * Data-only steps (210, 229/230, 234, 240, 242) are verified by migration tests. */
export function officialV43Artifacts(db: Database.Database): Array<[number, string, boolean]> {
  const columns: Array<[number, string, string]> = [
    [207, 'places', 'stop_type'],
    [211, 'file_links', 'budget_item_id'],
    [212, 'trip_files', 'message_id'],
    [215, 'places', 'fill_percent'],
    [217, 'day_assignments', 'end_day'],
    [220, 'budget_settlements', 'settled_at'],
    [221, 'places', 'amap_poi_id'],
    [224, 'bucket_list', 'visited_at'],
    [224, 'bucket_list', 'visited_source'],
    [225, 'visited_countries', 'source'],
    [226, 'mcp_tokens', 'scope_mode'],
    [226, 'mcp_tokens', 'api_scopes'],
    [227, 'places', 'source'],
    [228, 'day_assignments', 'accommodation_id'],
    [231, 'journey_entries', 'dismissed'],
    [232, 'journey_entries', 'country_code'],
    [233, 'journeys', 'show_verdict'],
    [233, 'journeys', 'show_mood'],
    [233, 'journeys', 'show_weather'],
    [235, 'journey_entries', 'source_assignment_id'],
    [239, 'document_sync_items', 'remote_trashed_at'],
    [243, 'users', 'immich_allow_insecure_tls'],
  ];
  const tables: Array<[number, string]> = [
    [206, 'place_shadow_picks'],
    [208, 'roadtrip_vias'],
    [209, 'roadtrip_day_tracks'],
    [213, 'collab_links'],
    [214, 'route_usage_daily'],
    [216, 'school_holiday_countries'],
    [216, 'school_holiday_regions'],
    [216, 'school_holiday_periods'],
    [218, 'roadtrip_day_boundaries'],
    [219, 'roadtrip_preferences'],
    [222, 'dawarich_connections'],
    [223, 'dawarich_visit_suggestions'],
    [236, 'document_providers'],
    [236, 'document_provider_fields'],
    [237, 'document_connections'],
    [237, 'trip_document_links'],
    [238, 'document_sync_items'],
  ];
  const boundary = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='roadtrip_day_boundaries'")
    .get() as { sql: string } | undefined;
  return [
    ...columns.map(([version, table, column]): [number, string, boolean] => [
      version,
      `${table}.${column}`,
      hasColumn(db, table, column),
    ]),
    ...tables.map(([version, table]): [number, string, boolean] => [version, table, hasTable(db, table)]),
    [
      241,
      'roadtrip_day_boundaries.unbounded_day_number',
      !!boundary && /CHECK\s*\(day_number\s*>=\s*1\)/i.test(boundary.sql),
    ],
    [
      244,
      'trg_place_regions_follow_place',
      !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_place_regions_follow_place'").get(),
    ],
  ];
}

export const FORK_RECONCILIATION = 'Migration20200101046330_adopt_fork_schema_lineages';

export function readForkLedger(db: Database.Database): { id: string; applied_at: string }[] {
  if (!hasTable(db, 'fork_schema_migrations')) return [];
  const rows = db.prepare('SELECT id, applied_at FROM fork_schema_migrations ORDER BY id').all() as {
    id: string;
    applied_at: string;
  }[];
  if (new Set(rows.map(({ id }) => id)).size !== rows.length) throw new Error('Duplicate fork migration IDs');
  for (const { id, applied_at } of rows) {
    const artifact = forkArtifacts.find(([known]) => known === id);
    if (!artifact || typeof applied_at !== 'string' || !applied_at || !artifact[1](db)) {
      throw new Error(`Unrecognized or incomplete fork migration ${id}`);
    }
  }
  return rows;
}

export type PositionalLineage =
  | { kind: 'official' | 'dual-lineage' | 'tours' | 'custom-v3'; upstreamStep: number }
  | { kind: 'numeric-fork'; upstreamStep: typeof LEGACY_FORK_BRIDGE_VERSION };

export function classifyPositionalLineage(db: Database.Database, version: number): PositionalLineage {
  const hasLedger = hasTable(db, 'fork_schema_migrations');
  const toursStep = version >= 216 && version <= 218 ? 215 : version >= 243 && version <= 246 ? 242 : null;
  if (toursStep !== null && hasTable(db, 'tour_types') && !hasLedger) {
    return { kind: 'tours', upstreamStep: toursStep };
  }

  const crosswalk = hasCrosswalkArtifacts(db);
  const fx = hasEnhancedFxArtifacts(db);
  const guest = hasGuestIdentityArtifacts(db);
  const push = hasWebPushArtifacts(db);
  const custom =
    fx ||
    guest ||
    push ||
    [
      'trip_exchange_rates',
      'global_exchange_rate_snapshots',
      'exchange_rate_batch_previews',
      'exchange_rate_quotes',
      'web_push_subscriptions',
    ].some((table) => hasTable(db, table)) ||
    ['budget_items', 'budget_settlements'].some((table) => hasColumn(db, table, 'exchange_rate_source'));

  const refuse = () => {
    throw new Error(
      `Unsupported schema version ${version}: schema artifacts do not prove a supported official or fork lineage`,
    );
  };
  if (version <= 180 && custom && !hasLedger && !crosswalk) {
    return { kind: 'custom-v3', upstreamStep: Math.min(version, 175) };
  }

  if (version >= 221 && !hasColumn(db, 'users', 'amap_api_key')) return refuse();
  if (version >= 245 && !hasTable(db, 'push_subscriptions')) return refuse();
  if (
    version >= 198 &&
    (!crosswalk ||
      officialV43Artifacts(db).some(([step, , present]) => {
        if (step === 244 && !hasLedger && version === 244 && hasTable(db, 'push_subscriptions')) return false;
        return present !== version >= step;
      }))
  ) {
    return refuse();
  }

  const official199 = hasColumn(db, 'reservations', 'ingest_state');
  const official200 = hasColumn(db, 'mcp_tokens', 'kind');
  const tail = [
    [202, hasColumn(db, 'journeys', 'show_trip_tracks')],
    [203, hasColumn(db, 'plugin_settings_fields', 'default_value')],
    [204, hasColumn(db, 'plugin_actions', 'scope')],
    [205, hasColumn(db, 'journey_entries', 'stats_excluded')],
  ] as const;
  if (
    version >= 199 &&
    version <= 202 &&
    !hasLedger &&
    !official199 &&
    !official200 &&
    tail.every(([, present]) => !present) &&
    (version < 200 || fx) &&
    (version < 201 || guest) &&
    (version < 202 || push)
  ) {
    return { kind: 'numeric-fork', upstreamStep: LEGACY_FORK_BRIDGE_VERSION };
  }

  if (
    version >= 198 &&
    (official199 !== version >= 199 ||
      official200 !== version >= 200 ||
      tail.some(([step, present]) => present !== version >= step))
  ) {
    return refuse();
  }
  if (version >= 201) {
    const naver = db.prepare("SELECT type FROM addons WHERE id = 'naver_list_import'").get() as
      { type: string } | undefined;
    if (naver && naver.type !== 'integration') return refuse();
  }
  if (hasLedger) {
    if (version < 198 || version > LAST_V4_FORK_VERSION) return refuse();
    return { kind: 'dual-lineage', upstreamStep: version };
  }
  if (custom) return refuse();
  return { kind: 'official', upstreamStep: version };
}

function enhancedFxV1(db: Database.Database): void {
  if (hasEnhancedFxArtifacts(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_exchange_rate_snapshots (
      base_currency TEXT PRIMARY KEY,
      rates_json TEXT NOT NULL,
      source_version TEXT NOT NULL,
      effective_date TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trip_exchange_rates (
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL CHECK(exchange_rate > 0),
      effective_date TEXT,
      source_version TEXT NOT NULL,
      set_at TEXT NOT NULL DEFAULT (datetime('now')),
      set_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      note TEXT,
      PRIMARY KEY (trip_id, currency)
    );

    CREATE TABLE IF NOT EXISTS exchange_rate_batch_previews (
      id TEXT PRIMARY KEY,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL CHECK(exchange_rate > 0),
      note TEXT,
      state_token TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_exchange_rate_batch_previews_created_at
      ON exchange_rate_batch_previews (created_at);
  `);

  for (const table of ['budget_items', 'budget_settlements']) {
    addColumn(db, table, "exchange_rate_source TEXT NOT NULL DEFAULT 'legacy'");
    addColumn(db, table, 'exchange_rate_source_version TEXT');
    addColumn(db, table, 'exchange_rate_effective_date TEXT');
    addColumn(db, table, 'exchange_rate_set_at TEXT');
    addColumn(db, table, 'exchange_rate_set_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
    addColumn(db, table, 'exchange_rate_note TEXT');
    addColumn(db, table, 'exchange_rate_reset_at TEXT');
    db.exec(`UPDATE ${table} SET exchange_rate_source = 'explicit' WHERE exchange_rate_source = 'manual'`);
  }

  db.exec(`
    UPDATE budget_items
    SET exchange_rate_source = CASE
      WHEN COALESCE(NULLIF(UPPER(currency), ''),
           (SELECT UPPER(COALESCE(currency, 'EUR')) FROM trips WHERE trips.id = budget_items.trip_id)) =
           (SELECT UPPER(COALESCE(currency, 'EUR')) FROM trips WHERE trips.id = budget_items.trip_id)
        THEN 'identity'
      ELSE exchange_rate_source
    END,
    exchange_rate_set_at = COALESCE(exchange_rate_set_at, created_at)
    WHERE exchange_rate_source = 'legacy';

    UPDATE budget_settlements
    SET exchange_rate_source = CASE
      WHEN COALESCE(NULLIF(UPPER(currency), ''),
           (SELECT UPPER(COALESCE(currency, 'EUR')) FROM trips WHERE trips.id = budget_settlements.trip_id)) =
           (SELECT UPPER(COALESCE(currency, 'EUR')) FROM trips WHERE trips.id = budget_settlements.trip_id)
        THEN 'identity'
      ELSE exchange_rate_source
    END,
    exchange_rate_set_at = COALESCE(exchange_rate_set_at, created_at)
    WHERE exchange_rate_source = 'legacy';
  `);
}

function guestIdentityV1(db: Database.Database): void {
  const hadLegacy = hasColumn(db, 'trip_members', 'guest_claim_prompted_at');
  const hadCompleted = hasColumn(db, 'trip_members', 'new_member_identity_check_completed_at');
  if (hadCompleted) return;
  addColumn(db, 'trip_members', 'new_member_identity_check_completed_at DATETIME');
  if (hadLegacy) {
    db.exec(`
      UPDATE trip_members
      SET new_member_identity_check_completed_at = COALESCE(
        new_member_identity_check_completed_at,
        guest_claim_prompted_at
      )
    `);
  } else {
    db.exec(`
      UPDATE trip_members
      SET new_member_identity_check_completed_at = CURRENT_TIMESTAMP
      WHERE user_id IN (SELECT id FROM users WHERE COALESCE(is_guest, 0) = 0)
    `);
  }
}

function webPushV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      installation_id TEXT NOT NULL,
      endpoint_hash TEXT NOT NULL UNIQUE,
      subscription_encrypted TEXT NOT NULL,
      origin TEXT NOT NULL,
      vapid_key_fingerprint TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'revoked', 'invalid', 'origin_mismatch')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_success_at DATETIME,
      last_error_at DATETIME,
      revoked_at DATETIME,
      UNIQUE(user_id, installation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_web_push_user_status
      ON web_push_subscriptions(user_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_web_push_delivery
      ON web_push_subscriptions(user_id, status, origin, vapid_key_fingerprint);
  `);
}

const forkArtifacts = [
  ['fork/v4-schema-crosswalk', hasCrosswalkArtifacts],
  ['fork/enhanced-fx-v1', hasEnhancedFxArtifacts],
  ['fork/guest-identity-v1', hasGuestIdentityArtifacts],
  ['fork/web-push-v1', hasWebPushArtifacts],
] as const satisfies readonly [ForkSchemaMigrationId, (db: Database.Database) => boolean][];

export function adoptForkMigrations(db: Database.Database): void {
  const applied = new Set(readForkLedger(db).map(({ id }) => id));
  ensureLedger(db);
  const record = db.prepare('INSERT INTO fork_schema_migrations (id) VALUES (?)');

  if (!hasCrosswalkArtifacts(db)) throw new Error('Missing official v4 schema crosswalk');
  if (!applied.has('fork/v4-schema-crosswalk')) record.run('fork/v4-schema-crosswalk');
  if (!applied.has('fork/enhanced-fx-v1')) {
    enhancedFxV1(db);
    if (!hasEnhancedFxArtifacts(db)) throw new Error('Incomplete enhanced FX schema');
    record.run('fork/enhanced-fx-v1');
  }
  if (
    !applied.has('fork/guest-identity-v1') ||
    !hasColumn(db, 'trip_members', 'new_member_identity_check_completed_at')
  ) {
    guestIdentityV1(db);
    if (!applied.has('fork/guest-identity-v1')) record.run('fork/guest-identity-v1');
  }
  if (!applied.has('fork/web-push-v1')) {
    webPushV1(db);
    if (!hasWebPushArtifacts(db)) throw new Error('Incomplete Web Push schema');
    record.run('fork/web-push-v1');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_budget_items_exchange_rate_set_by ON budget_items(exchange_rate_set_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_budget_settlements_exchange_rate_set_by ON budget_settlements(exchange_rate_set_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_trip_exchange_rates_set_by ON trip_exchange_rates(set_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_exchange_rate_batch_previews_trip ON exchange_rate_batch_previews(trip_id);
    CREATE INDEX IF NOT EXISTS idx_exchange_rate_batch_previews_created_by ON exchange_rate_batch_previews(created_by_user_id);
  `);
}
