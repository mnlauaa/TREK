import {
  addColumn,
  hasColumn,
  hasCrosswalkArtifacts,
  hasEnhancedFxArtifacts,
  hasTable,
  hasWebPushArtifacts,
  readForkLedger,
} from '../fork-migrations';
import { Migration } from '@mikro-orm/migrations';
import type { SqliteConnection } from '@mikro-orm/sqlite';

import type Database from 'better-sqlite3';

export class Migration20200101046330_adopt_fork_schema_lineages extends Migration {
  override name = 'Migration20200101046330_adopt_fork_schema_lineages';

  override async up(): Promise<void> {
    const db = await (this.driver.getConnection() as SqliteConnection).getNativeClient();
    if (!db.inTransaction) throw new Error('Fork schema adoption requires a transaction');
    adoptForkMigrations(db);
  }
}

function ensureLedger(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fork_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function enhancedFxV1(db: Database.Database): void {
  if (hasEnhancedFxArtifacts(db)) {
    if (hasTable(db, 'exchange_rate_quotes')) {
      for (const table of ['budget_items', 'budget_settlements']) {
        db.exec(`UPDATE ${table} SET exchange_rate_source = 'explicit' WHERE exchange_rate_source = 'manual'`);
      }
    }
    return;
  }
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
      set_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
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
  `);
}

function adoptForkMigrations(db: Database.Database): void {
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
    CREATE INDEX IF NOT EXISTS idx_web_push_user_status
      ON web_push_subscriptions(user_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_web_push_delivery
      ON web_push_subscriptions(user_id, status, origin, vapid_key_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_exchange_rate_batch_previews_created_at
      ON exchange_rate_batch_previews(created_at);
    CREATE INDEX IF NOT EXISTS idx_budget_items_exchange_rate_set_by ON budget_items(exchange_rate_set_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_budget_settlements_exchange_rate_set_by ON budget_settlements(exchange_rate_set_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_trip_exchange_rates_set_by ON trip_exchange_rates(set_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_exchange_rate_batch_previews_trip ON exchange_rate_batch_previews(trip_id);
    CREATE INDEX IF NOT EXISTS idx_exchange_rate_batch_previews_created_by ON exchange_rate_batch_previews(created_by_user_id);
  `);
}
