import {
  classifyForkLineage,
  FORK_SCHEMA_MIGRATION_IDS,
  normalizeLegacyForkLineage,
  runForkMigrations,
  UPSTREAM_SCHEMA_VERSION,
} from '../../../src/db/fork-migrations';
import { runMigrations } from '../../../src/db/migrations';
import { createTestDb } from '../../helpers/test-db';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

describe('v4 fork migration lineages', () => {
  let db: Database.Database | null = null;
  afterEach(() => {
    db?.close();
    db = null;
  });

  const dropLedger = (target: Database.Database) => target.exec('DROP TABLE IF EXISTS fork_schema_migrations');

  const v42Columns = [
    [202, 'journeys', 'show_trip_tracks'],
    [203, 'plugin_settings_fields', 'default_value'],
    [204, 'plugin_actions', 'scope'],
    [205, 'journey_entries', 'stats_excluded'],
  ] as const;

  // Recreate the actual prior tail: leaving these columns on a database whose
  // metadata says 200 would conceal the exact skipped-migration regression.
  const removeLaterOfficialArtifacts = (target: Database.Database, version: number) => {
    for (const [introduced, table, column] of v42Columns) {
      if (introduced > version) target.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
    if (version < 201) target.exec("UPDATE addons SET type = 'trip' WHERE id = 'naver_list_import'");
  };

  const removeForkArtifacts = (target: Database.Database) => {
    dropLedger(target);
    target.exec(
      'DROP TABLE trip_exchange_rates; DROP TABLE global_exchange_rate_snapshots; DROP TABLE exchange_rate_batch_previews; DROP TABLE web_push_subscriptions',
    );
    target.exec('ALTER TABLE trip_members DROP COLUMN new_member_identity_check_completed_at');
    for (const table of ['budget_items', 'budget_settlements']) {
      for (const column of [
        'exchange_rate_source',
        'exchange_rate_source_version',
        'exchange_rate_effective_date',
        'exchange_rate_set_at',
        'exchange_rate_set_by_user_id',
        'exchange_rate_note',
        'exchange_rate_reset_at',
      ]) {
        target.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      }
    }
  };

  const removeOfficial176To180Artifacts = (target: Database.Database) => {
    for (const table of ['vacay_shares', 'place_ratings', 'collection_place_ratings']) {
      target.exec(`DROP TABLE ${table}`);
    }
    target.exec('ALTER TABLE vacay_entries DROP COLUMN fraction');
    target.exec('ALTER TABLE day_assignments DROP COLUMN leg_transport_mode');
    target.exec('ALTER TABLE days DROP COLUMN default_transport_mode');
    target.exec('ALTER TABLE vacay_plans DROP COLUMN school_holidays_enabled');
    target.exec('ALTER TABLE vacay_holiday_calendars DROP COLUMN type');
  };

  const removeOfficialV411Tail = (target: Database.Database) => {
    target.exec('ALTER TABLE reservations DROP COLUMN ingest_state');
    target.exec('ALTER TABLE mcp_tokens DROP COLUMN kind');
  };

  const expectFinalLineage = (target: Database.Database) => {
    expect(target.prepare('SELECT version FROM schema_version').get()).toEqual({ version: UPSTREAM_SCHEMA_VERSION });
    expect(
      (target.prepare('SELECT id FROM fork_schema_migrations ORDER BY id').all() as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    ).toEqual([...FORK_SCHEMA_MIGRATION_IDS].sort());
    expect(
      target.prepare("SELECT 1 FROM pragma_table_info('reservations') WHERE name='ingest_state'").get(),
    ).toBeTruthy();
    expect(target.prepare("SELECT 1 FROM pragma_table_info('mcp_tokens') WHERE name='kind'").get()).toBeTruthy();
    for (const [, table, column] of v42Columns) {
      expect(target.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name=?').get(table, column)).toBeTruthy();
    }
    expect(target.prepare("SELECT type FROM addons WHERE id = 'naver_list_import'").get()).toEqual({
      type: 'integration',
    });
    expect(
      target.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='trip_exchange_rates'").get(),
    ).toBeTruthy();
    expect(
      target
        .prepare("SELECT 1 FROM pragma_table_info('trip_members') WHERE name='new_member_identity_check_completed_at'")
        .get(),
    ).toBeTruthy();
    expect(
      target.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_push_subscriptions'").get(),
    ).toBeTruthy();
    expect(target.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(target.pragma('foreign_key_check')).toEqual([]);
  };

  it('records all named fork migrations on a fresh database and is idempotent', () => {
    db = createTestDb();
    expectFinalLineage(db);
    const before = db.prepare('SELECT id, applied_at FROM fork_schema_migrations ORDER BY id').all();
    runMigrations(db);
    expectFinalLineage(db);
    expect(db.prepare('SELECT id, applied_at FROM fork_schema_migrations ORDER BY id').all()).toEqual(before);
  });

  it.each([175, 176, 177, 178, 179, 180])(
    'converges a clean/custom version %i baseline through the named crosswalk',
    (version) => {
      db = createTestDb();
      dropLedger(db);
      removeOfficial176To180Artifacts(db);
      removeLaterOfficialArtifacts(db, version);
      db.prepare('UPDATE schema_version SET version = ?').run(version);

      runMigrations(db);
      expectFinalLineage(db);
      for (const [table, column] of [
        ['vacay_entries', 'fraction'],
        ['day_assignments', 'leg_transport_mode'],
        ['days', 'default_transport_mode'],
        ['vacay_plans', 'school_holidays_enabled'],
        ['vacay_holiday_calendars', 'type'],
      ]) {
        expect(db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column)).toBeTruthy();
      }
    },
  );

  it.each([199, 200, 201, 202])('normalizes a verified legacy fork schema %i without replacing data', (version) => {
    db = createTestDb();
    db.prepare(
      "INSERT INTO users (username,email,password_hash,role) VALUES ('owner','owner@example.test','x','admin')",
    ).run();
    const user = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get() as { id: number };
    const tripId = Number(
      db.prepare("INSERT INTO trips (user_id,title,currency) VALUES (?, 'Preserved','EUR')").run(user.id)
        .lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO trip_exchange_rates
         (trip_id,currency,exchange_rate,source_version,set_by_user_id,note)
       VALUES (?, 'USD', 1.2, 'custom:before-v4.1', ?, 'keep me')`,
    ).run(tripId, user.id);

    dropLedger(db);
    removeOfficialV411Tail(db);
    removeLaterOfficialArtifacts(db, 200);
    db.prepare('UPDATE schema_version SET version = ?').run(version);
    expect(classifyForkLineage(db, version)).toBe('legacy-fork-numeric');
    expect(normalizeLegacyForkLineage(db, version)).toBe(200);
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('journeys') WHERE name='show_trip_tracks'").get(),
    ).toBeUndefined();
    runMigrations(db);

    expectFinalLineage(db);
    expect(
      db
        .prepare('SELECT exchange_rate,source_version,note FROM trip_exchange_rates WHERE trip_id=? AND currency=?')
        .get(tripId, 'USD'),
    ).toEqual({ exchange_rate: 1.2, source_version: 'custom:before-v4.1', note: 'keep me' });
  });

  it.each([199, 200, 201, 202, 203, 204, 205])('adds fork schemas to a clean official schema %i', (version) => {
    db = createTestDb();
    removeForkArtifacts(db);
    removeLaterOfficialArtifacts(db, version);
    if (version === 199) db.exec('ALTER TABLE mcp_tokens DROP COLUMN kind');
    db.prepare('UPDATE schema_version SET version = ?').run(version);
    expect(classifyForkLineage(db, version)).toBe(version >= 201 ? 'official-v4.2' : 'official-v4.1');

    runMigrations(db);
    expectFinalLineage(db);
  });

  it.each([200, 201, 202, 203, 204])('resumes the existing dual lineage at official version %i', (version) => {
    db = createTestDb();
    const ledger = db.prepare('SELECT * FROM fork_schema_migrations ORDER BY id').all();
    removeLaterOfficialArtifacts(db, version);
    db.prepare('UPDATE schema_version SET version = ?').run(version);
    runMigrations(db);
    expectFinalLineage(db);
    expect(db.prepare('SELECT * FROM fork_schema_migrations ORDER BY id').all()).toEqual(ledger);
    runMigrations(db);
    expectFinalLineage(db);
  });

  it('rejects a current version whose migration artifacts are missing without changing metadata', () => {
    db = createTestDb();
    db.exec('ALTER TABLE journey_entries DROP COLUMN stats_excluded');
    expect(() => runMigrations(db!)).toThrow(/Unsupported schema version 205/);
    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: 205 });
  });

  it('preserves v4.1.1 financial provenance, guest identity and encrypted push state byte-for-byte', () => {
    db = createTestDb();
    removeLaterOfficialArtifacts(db, 200);
    db.exec(`
      UPDATE schema_version SET version = 200;
      INSERT INTO users (id,username,email,password_hash) VALUES (901,'owner','owner@test.invalid','hash');
      INSERT INTO users (id,username,email,password_hash,is_guest) VALUES (902,'guest','guest@test.invalid','hash',1);
      INSERT INTO trips (id,user_id,title,currency) VALUES (903,901,'Preserve','USD');
      INSERT INTO trip_members (trip_id,user_id,new_member_identity_check_completed_at) VALUES (903,902,'2026-01-01');
      INSERT INTO budget_items (trip_id,name,total_price,currency,exchange_rate,exchange_rate_source,exchange_rate_source_version,exchange_rate_note)
        VALUES (903,'Refund',-25,'GBP',0.8,'explicit','recorded-rate','keep expense');
      INSERT INTO budget_settlements (trip_id,from_user_id,to_user_id,amount,currency,exchange_rate,exchange_rate_source,exchange_rate_note)
        VALUES (903,901,902,12,'GBP',0.75,'trip','keep payment');
      INSERT INTO trip_exchange_rates (trip_id,currency,exchange_rate,source_version,note)
        VALUES (903,'GBP',0.75,'trip-rate','keep default');
      INSERT INTO settings (user_id,key,value) VALUES (901,'common_currencies','["HKD","TWD"]');
      INSERT INTO web_push_subscriptions (user_id,installation_id,endpoint_hash,subscription_encrypted,origin,vapid_key_fingerprint,label)
        VALUES (901,'browser','endpoint-hash','encrypted-subscription','https://trek.test','vapid-fingerprint','Phone');
    `);
    const tables = [
      'users',
      'trips',
      'trip_members',
      'budget_items',
      'budget_settlements',
      'trip_exchange_rates',
      'settings',
      'web_push_subscriptions',
      'fork_schema_migrations',
    ];
    const snapshot = () =>
      Object.fromEntries(tables.map((table) => [table, db!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    const before = snapshot();
    runMigrations(db);
    expectFinalLineage(db);
    expect(snapshot()).toEqual(before);
    runMigrations(db);
    expect(snapshot()).toEqual(before);
  });

  it('rejects unknown fork migration IDs and future official versions', () => {
    db = createTestDb();
    db.exec("INSERT INTO fork_schema_migrations (id) VALUES ('fork/unknown')");
    expect(() => runMigrations(db!)).toThrow(/Unsupported schema version 205/);
    db.exec("DELETE FROM fork_schema_migrations WHERE id = 'fork/unknown'");
    db.exec('UPDATE schema_version SET version = 206');
    expect(() => runMigrations(db!)).toThrow(/Unsupported schema version 206/);
  });

  it('rejects an ambiguous schema newer than upstream instead of guessing', () => {
    db = createTestDb();
    dropLedger(db);
    db.exec('DROP TABLE web_push_subscriptions');
    db.prepare('UPDATE schema_version SET version = 202').run();
    expect(() => runMigrations(db!)).toThrow(/Unsupported schema version 202/);
  });

  it('records a named migration only after its transaction succeeds', () => {
    db = new Database(':memory:');
    expect(() => runForkMigrations(db!)).toThrow();
    expect(db.prepare('SELECT id FROM fork_schema_migrations').all()).toEqual([]);
  });
});
