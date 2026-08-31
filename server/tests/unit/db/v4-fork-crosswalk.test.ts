import { FORK_SCHEMA_MIGRATION_IDS, runForkMigrations, UPSTREAM_SCHEMA_VERSION } from '../../../src/db/fork-migrations';
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
    db.prepare('UPDATE schema_version SET version = ?').run(version);
    runMigrations(db);

    expectFinalLineage(db);
    expect(
      db
        .prepare('SELECT exchange_rate,source_version,note FROM trip_exchange_rates WHERE trip_id=? AND currency=?')
        .get(tripId, 'USD'),
    ).toEqual({ exchange_rate: 1.2, source_version: 'custom:before-v4.1', note: 'keep me' });
  });

  it.each([199, 200])('adds fork schemas to a clean official v4.1 schema %i', (version) => {
    db = createTestDb();
    dropLedger(db);
    db.exec(
      'DROP TABLE trip_exchange_rates; DROP TABLE global_exchange_rate_snapshots; DROP TABLE exchange_rate_batch_previews;',
    );
    db.exec('DROP TABLE web_push_subscriptions');
    db.exec('ALTER TABLE trip_members DROP COLUMN new_member_identity_check_completed_at');
    if (version === 199) db.exec('ALTER TABLE mcp_tokens DROP COLUMN kind');
    db.prepare('UPDATE schema_version SET version = ?').run(version);

    runMigrations(db);
    expectFinalLineage(db);
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
