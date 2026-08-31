import type Database from 'better-sqlite3';

export const UPSTREAM_SCHEMA_VERSION = 200;

export const FORK_SCHEMA_MIGRATION_IDS = [
  'fork/v4-schema-crosswalk',
  'fork/enhanced-fx-v1',
  'fork/guest-identity-v1',
  'fork/web-push-v1',
] as const;

export type ForkSchemaMigrationId = (typeof FORK_SCHEMA_MIGRATION_IDS)[number];

interface ForkMigration {
  id: ForkSchemaMigrationId;
  run: (db: Database.Database) => void;
}

const hasTable = (db: Database.Database, table: string): boolean =>
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

function ensureOfficialV411Tail(db: Database.Database): void {
  if (!hasTable(db, 'reservations') || !hasTable(db, 'mcp_tokens')) {
    throw new Error('Legacy fork schema is missing reservations or mcp_tokens; refusing version normalization.');
  }
  addColumn(db, 'reservations', "ingest_state TEXT NOT NULL DEFAULT 'live'");
  addColumn(db, 'mcp_tokens', "kind TEXT NOT NULL DEFAULT 'mcp'");
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
    hasColumn(db, 'budget_items', 'exchange_rate_source') &&
    hasColumn(db, 'budget_settlements', 'exchange_rate_source')
  );
}

function hasGuestIdentityArtifacts(db: Database.Database): boolean {
  return (
    hasColumn(db, 'trip_members', 'new_member_identity_check_completed_at') ||
    hasColumn(db, 'trip_members', 'guest_claim_prompted_at')
  );
}

function hasWebPushArtifacts(db: Database.Database): boolean {
  return hasTable(db, 'web_push_subscriptions');
}

/**
 * The released fork used numeric slots 199-202 for its own schemas. v4.1.1
 * uses 199-200 for upstream additions, so a verified legacy fork must be
 * translated before the official runner reads the number. The schema is never
 * rolled back: this transaction installs the missing upstream tail and only
 * normalizes the version metadata to the official lineage.
 */
export function normalizeLegacyForkLineage(
  db: Database.Database,
  currentVersion: number,
  upstreamVersion = UPSTREAM_SCHEMA_VERSION,
): number {
  if (upstreamVersion !== UPSTREAM_SCHEMA_VERSION) {
    throw new Error(`Fork lineage bridge expected upstream schema ${UPSTREAM_SCHEMA_VERSION}, got ${upstreamVersion}.`);
  }

  const hasLedger = hasTable(db, 'fork_schema_migrations');
  const official199 = hasColumn(db, 'reservations', 'ingest_state');
  const official200 = hasColumn(db, 'mcp_tokens', 'kind');
  const crosswalk = hasCrosswalkArtifacts(db);
  const fx = hasEnhancedFxArtifacts(db);
  const guest = hasGuestIdentityArtifacts(db);
  const webPush = hasWebPushArtifacts(db);

  const legacyFork =
    !hasLedger &&
    ((currentVersion === 199 && crosswalk && !official199) ||
      (currentVersion === 200 && crosswalk && fx && !official200) ||
      (currentVersion === 201 && crosswalk && fx && guest) ||
      (currentVersion === 202 && crosswalk && fx && guest && webPush));

  if (legacyFork) {
    db.transaction(() => {
      ensureOfficialV411Tail(db);
      ensureLedger(db);
      db.prepare('UPDATE schema_version SET version = ?').run(upstreamVersion);
    })();
    console.log(`[DB] Normalized legacy fork schema ${currentVersion} to upstream schema ${upstreamVersion}`);
    return upstreamVersion;
  }

  if (currentVersion > upstreamVersion) {
    throw new Error(
      `Unsupported schema version ${currentVersion}: it is newer than upstream ${upstreamVersion} but does not match the legacy fork lineage.`,
    );
  }

  return currentVersion;
}

function crosswalkV4Schema(db: Database.Database): void {
  addColumn(db, 'vacay_entries', 'fraction REAL NOT NULL DEFAULT 1');
  db.exec(`
    CREATE TABLE IF NOT EXISTS vacay_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (owner_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_vacay_shares_user ON vacay_shares (user_id);

    CREATE TABLE IF NOT EXISTS place_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(place_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_place_ratings_place ON place_ratings (place_id);

    CREATE TABLE IF NOT EXISTS collection_place_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_place_id INTEGER NOT NULL REFERENCES collection_places(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(collection_place_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_collection_place_ratings_place
      ON collection_place_ratings (collection_place_id);
  `);
  addColumn(db, 'day_assignments', 'leg_transport_mode TEXT');
  addColumn(db, 'days', 'default_transport_mode TEXT');
  addColumn(db, 'vacay_plans', 'school_holidays_enabled INTEGER DEFAULT 0');
  addColumn(db, 'vacay_holiday_calendars', "type TEXT NOT NULL DEFAULT 'public_holiday'");
}

function enhancedFxV1(db: Database.Database): void {
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
    DROP TABLE IF EXISTS exchange_rate_quotes;
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
    exchange_rate_set_at = COALESCE(exchange_rate_set_at, created_at);

    UPDATE budget_settlements
    SET exchange_rate_source = CASE
      WHEN COALESCE(NULLIF(UPPER(currency), ''),
           (SELECT UPPER(COALESCE(currency, 'EUR')) FROM trips WHERE trips.id = budget_settlements.trip_id)) =
           (SELECT UPPER(COALESCE(currency, 'EUR')) FROM trips WHERE trips.id = budget_settlements.trip_id)
        THEN 'identity'
      ELSE exchange_rate_source
    END,
    exchange_rate_set_at = COALESCE(exchange_rate_set_at, created_at);
  `);
}

function guestIdentityV1(db: Database.Database): void {
  const hadLegacy = hasColumn(db, 'trip_members', 'guest_claim_prompted_at');
  const hadCompleted = hasColumn(db, 'trip_members', 'new_member_identity_check_completed_at');
  if (!hadCompleted) addColumn(db, 'trip_members', 'new_member_identity_check_completed_at DATETIME');
  if (hadLegacy) {
    db.exec(`
      UPDATE trip_members
      SET new_member_identity_check_completed_at = COALESCE(
        new_member_identity_check_completed_at,
        guest_claim_prompted_at
      )
    `);
  } else if (!hadCompleted) {
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

const FORK_MIGRATIONS: readonly ForkMigration[] = [
  { id: 'fork/v4-schema-crosswalk', run: crosswalkV4Schema },
  { id: 'fork/enhanced-fx-v1', run: enhancedFxV1 },
  { id: 'fork/guest-identity-v1', run: guestIdentityV1 },
  { id: 'fork/web-push-v1', run: webPushV1 },
];

export function runForkMigrations(db: Database.Database): void {
  ensureLedger(db);
  const applied = new Set(
    (db.prepare('SELECT id FROM fork_schema_migrations').all() as Array<{ id: string }>).map((row) => row.id),
  );

  for (const migration of FORK_MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    console.log(`[DB] Running fork migration ${migration.id}`);
    db.transaction(() => {
      migration.run(db);
      db.prepare('INSERT INTO fork_schema_migrations (id) VALUES (?)').run(migration.id);
    })();
  }
}
