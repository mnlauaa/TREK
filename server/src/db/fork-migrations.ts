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

export const hasColumn = (db: Database.Database, table: string, column: string): boolean =>
  hasTable(db, table) && !!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column);

function hasColumns(db: Database.Database, table: string, columns: readonly string[]): boolean {
  if (!hasTable(db, table)) return false;
  const actual = new Set(db.prepare('SELECT name FROM pragma_table_info(?)').pluck().all(table));
  return columns.every((column) => actual.has(column));
}

function hasForeignKey(
  db: Database.Database,
  table: string,
  column: string,
  target: string,
  deleteRule: string,
): boolean {
  return !!db
    .prepare('SELECT 1 FROM pragma_foreign_key_list(?) WHERE "from" = ? AND "table" = ? AND "to" = ? AND on_delete = ?')
    .get(table, column, target, 'id', deleteRule);
}

function hasUniqueKey(db: Database.Database, table: string, columns: readonly string[]): boolean {
  const indexes = db
    .prepare('SELECT name FROM pragma_index_list(?) WHERE "unique" = 1 AND partial = 0')
    .pluck()
    .all(table);
  const indexColumns = db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').pluck();
  return indexes.some((name) => {
    const actual = indexColumns.all(name);
    return actual.length === columns.length && actual.every((column, index) => column === columns[index]);
  });
}

function hasPositiveRateCheck(db: Database.Database, table: string): boolean {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").pluck().get(table);
  return typeof definition === 'string' && /CHECK\s*\(\s*exchange_rate\s*>\s*0\s*\)/i.test(definition);
}

export const addColumn = (db: Database.Database, table: string, definition: string): void => {
  const column = definition.trim().split(/\s+/, 1)[0];
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
};

export function normalizeNumericFork(db: Database.Database): void {
  if (!hasTable(db, 'reservations') || !hasTable(db, 'mcp_tokens')) {
    throw new Error('Legacy fork schema is missing reservations or mcp_tokens; refusing version normalization.');
  }
  addColumn(db, 'reservations', "ingest_state TEXT NOT NULL DEFAULT 'live'");
  addColumn(db, 'mcp_tokens', "kind TEXT NOT NULL DEFAULT 'mcp'");
  db.prepare('UPDATE schema_version SET version = ?').run(LEGACY_FORK_BRIDGE_VERSION);
}

export function hasCrosswalkArtifacts(db: Database.Database): boolean {
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

export function hasEnhancedFxArtifacts(db: Database.Database): boolean {
  return (
    hasColumns(db, 'global_exchange_rate_snapshots', [
      'base_currency',
      'rates_json',
      'source_version',
      'effective_date',
      'fetched_at',
    ]) &&
    hasUniqueKey(db, 'global_exchange_rate_snapshots', ['base_currency']) &&
    hasColumns(db, 'trip_exchange_rates', [
      'trip_id',
      'currency',
      'exchange_rate',
      'source_version',
      'effective_date',
      'set_at',
      'set_by_user_id',
      'note',
    ]) &&
    hasUniqueKey(db, 'trip_exchange_rates', ['trip_id', 'currency']) &&
    hasForeignKey(db, 'trip_exchange_rates', 'trip_id', 'trips', 'CASCADE') &&
    hasForeignKey(db, 'trip_exchange_rates', 'set_by_user_id', 'users', 'SET NULL') &&
    hasPositiveRateCheck(db, 'trip_exchange_rates') &&
    hasColumns(db, 'exchange_rate_batch_previews', [
      'id',
      'trip_id',
      'currency',
      'exchange_rate',
      'note',
      'state_token',
      'preview_json',
      'created_by_user_id',
      'created_at',
    ]) &&
    hasUniqueKey(db, 'exchange_rate_batch_previews', ['id']) &&
    hasForeignKey(db, 'exchange_rate_batch_previews', 'trip_id', 'trips', 'CASCADE') &&
    hasForeignKey(db, 'exchange_rate_batch_previews', 'created_by_user_id', 'users', 'CASCADE') &&
    hasPositiveRateCheck(db, 'exchange_rate_batch_previews') &&
    ['budget_items', 'budget_settlements'].every(
      (table) =>
        hasColumns(
          db,
          table,
          ['source', 'source_version', 'effective_date', 'set_at', 'set_by_user_id', 'note', 'reset_at'].map(
            (field) => `exchange_rate_${field}`,
          ),
        ) && hasForeignKey(db, table, 'exchange_rate_set_by_user_id', 'users', 'SET NULL'),
    )
  );
}

function hasGuestIdentityArtifacts(db: Database.Database): boolean {
  return (
    hasColumn(db, 'trip_members', 'new_member_identity_check_completed_at') ||
    hasColumn(db, 'trip_members', 'guest_claim_prompted_at')
  );
}

export function hasWebPushArtifacts(db: Database.Database): boolean {
  const table = 'web_push_subscriptions';
  return (
    hasColumns(db, table, [
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
    ]) &&
    hasUniqueKey(db, table, ['endpoint_hash']) &&
    hasUniqueKey(db, table, ['user_id', 'installation_id']) &&
    hasForeignKey(db, table, 'user_id', 'users', 'CASCADE')
  );
}

/** Structural markers of the official 4.3 chain, shared by startup and audit.
 * Data-only steps (210, 229/230, 234, 240, 242) are verified by migration tests. */
function officialPositionalArtifacts(db: Database.Database): Array<[number, string, boolean]> {
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
    [247, 'day_assignments', 'route_excluded'],
    [248, 'packing_items', 'packed_quantity'],
    [249, 'bucket_list', 'region_code'],
    [250, 'vacay_company_holidays', 'fraction'],
    [251, 'journey_entries', 'is_draft'],
    [252, 'share_tokens', 'share_travel_only'],
    [252, 'share_tokens', 'share_hide_images'],
    [253, 'budget_settlements', 'note'],
    [255, 'packing_template_items', 'weight_grams'],
    [255, 'packing_template_items', 'quantity'],
    [255, 'packing_template_items', 'bag_name'],
    [256, 'journeys', 'status_override'],
    [257, 'places', 'email'],
    [257, 'places', 'opening_hours'],
    [258, 'journeys', 'photo_location'],
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
    [245, 'push_subscriptions'],
    [254, 'google_api_usage'],
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
  if (
    version >= 198 &&
    (!crosswalk ||
      officialPositionalArtifacts(db).some(([step, , present]) => {
        if ((step === 244 || step === 245) && !hasLedger && version === 244 && hasTable(db, 'push_subscriptions')) {
          return false;
        }
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

const forkArtifacts = [
  ['fork/v4-schema-crosswalk', hasCrosswalkArtifacts],
  ['fork/enhanced-fx-v1', hasEnhancedFxArtifacts],
  ['fork/guest-identity-v1', hasGuestIdentityArtifacts],
  ['fork/web-push-v1', hasWebPushArtifacts],
] as const satisfies readonly [ForkSchemaMigrationId, (db: Database.Database) => boolean][];
