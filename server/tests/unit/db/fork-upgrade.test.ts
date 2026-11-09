import { FORK_RECONCILIATION, FORK_SCHEMA_MIGRATION_IDS } from '../../../src/db/fork-migrations';
import { BootstrapMigrator, migrateToHead, TrekCliMigrator } from '../../../src/db/legacy-baseline';
import { preMigrateSnapshot } from '../../../src/db/pre-migrate-snapshot';
import { openLegacyFixture, removeLegacyFixtureFiles } from '../../helpers/legacy-fixture';
import { MikroORM } from '@mikro-orm/sqlite';

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const migrations = path.join(__dirname, '../../../src/db/migrations');
const time = new Date('2026-11-01T10:00:00Z');
const queries = [
  'SELECT id, user_id, new_member_identity_check_completed_at FROM trip_members ORDER BY id',
  'SELECT id, total_price, exchange_rate, exchange_rate_source, exchange_rate_set_at, exchange_rate_set_by_user_id, ticket_json FROM budget_items ORDER BY id',
  'SELECT id, amount, exchange_rate, exchange_rate_source, exchange_rate_set_by_user_id FROM budget_settlements ORDER BY id',
  'SELECT * FROM budget_item_members',
  'SELECT * FROM budget_item_payers',
  'SELECT * FROM reservation_travelers',
  'SELECT * FROM trip_exchange_rates',
  'SELECT * FROM global_exchange_rate_snapshots',
  'SELECT * FROM exchange_rate_batch_previews',
  'SELECT * FROM web_push_subscriptions',
  "SELECT * FROM app_settings WHERE key LIKE 'web_push_vapid_%' ORDER BY key",
];

function sourceStatement(db: Database.Database, statement: string) {
  // test-sql-allow: reads schema and fixtures built by historical runners, before current ORM entities apply.
  return db.prepare(statement);
}

function protectedRows(db: Database.Database) {
  return queries.map((query) => sourceStatement(db, query).all());
}

function catalog(db: Database.Database) {
  return sourceStatement(db, 'SELECT * FROM sqlite_master ORDER BY name').all();
}

async function openFixture(step: 180 | 199 | 202 | 244 | 258) {
  const legacy = openLegacyFixture(step === 258 ? 'legacy-v258' : `fork-v${step}`);
  const file = legacy.name;
  legacy.close();
  const orm = await MikroORM.init({
    entities: [],
    discovery: { warnWhenNoEntities: false },
    migrations: { path: migrations, pathTs: migrations, snapshot: false, silent: true },
    dbName: file,
  });
  const connection = orm.em.getConnection();
  const db = await connection.getNativeClient();
  const migrator = new BootstrapMigrator(orm.em);
  const boot = () =>
    migrateToHead(
      connection,
      migrator,
      undefined,
      undefined,
      preMigrateSnapshot(connection, undefined, () => time),
    );
  return { orm, db, migrator, boot };
}

afterEach(() => {
  vi.unstubAllEnvs();
  removeLegacyFixtureFiles();
});

describe('upgrading a populated legacy fork', () => {
  it.each([202, 244] as const)('keeps protected values at step %s and reruns without a new snapshot', async (step) => {
    vi.stubEnv('TREK_DB_PRE_MIGRATE_SNAPSHOT', 'true');
    const { orm, db, boot } = await openFixture(step);
    try {
      const values = protectedRows(db);
      const existingLedger =
        step === 244 ? sourceStatement(db, 'SELECT * FROM fork_schema_migrations ORDER BY id').all() : null;
      await boot();

      expect(protectedRows(db)).toEqual(values);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      const executed = sourceStatement(db, 'SELECT name FROM mikro_orm_migrations').pluck().all();
      expect(executed).toContain(FORK_RECONCILIATION);
      expect(sourceStatement(db, "SELECT type FROM addons WHERE id = 'naver_list_import'").pluck().get()).toBe(
        'integration',
      );
      expect(sourceStatement(db, 'SELECT ingest_state FROM reservations').pluck().get()).toBe('live');
      expect(sourceStatement(db, 'SELECT show_trip_tracks FROM journeys').all()).toEqual([]);
      const ledger = sourceStatement(db, 'SELECT * FROM fork_schema_migrations ORDER BY id').all();
      expect(sourceStatement(db, 'SELECT id FROM fork_schema_migrations ORDER BY id').pluck().all()).toEqual(
        [...FORK_SCHEMA_MIGRATION_IDS].sort(),
      );
      if (existingLedger) expect(ledger).toEqual(expect.arrayContaining(existingLedger));

      const dir = path.dirname(db.name);
      const snapshots = () => fs.readdirSync(dir).filter((entry) => entry.startsWith('pre-migrate-'));
      const files = snapshots();
      expect(files).toEqual([`pre-migrate-legacy-${step}-20261101T100000Z.db`]);
      const copy = new Database(path.join(dir, files[0]!), { readonly: true, fileMustExist: true });
      try {
        expect(sourceStatement(copy, 'SELECT version FROM schema_version').pluck().get()).toBe(step);
        expect(catalog(copy)).not.toEqual(catalog(db));
        expect(
          sourceStatement(copy, "SELECT name FROM sqlite_master WHERE name = 'mikro_orm_migrations'").get(),
        ).toBeUndefined();
        expect(protectedRows(copy)).toEqual(values);
        if (step === 202) {
          expect(
            sourceStatement(copy, "SELECT name FROM pragma_table_info('reservations') WHERE name='ingest_state'").get(),
          ).toBeUndefined();
        }
      } finally {
        copy.close();
      }

      await boot();
      expect(snapshots()).toEqual(files);
      expect(protectedRows(db)).toEqual(values);
      expect(sourceStatement(db, 'SELECT * FROM fork_schema_migrations ORDER BY id').all()).toEqual(ledger);
      expect(sourceStatement(db, 'SELECT name FROM mikro_orm_migrations').pluck().all()).toEqual(executed);
    } finally {
      await orm.close(true);
    }
  });

  it('preserves native push opt-outs and defaults while canonical fork preferences win collisions', async () => {
    const { orm, db, boot } = await openFixture(244);
    try {
      sourceStatement(
        db,
        `INSERT INTO notification_channel_preferences (user_id, event_type, channel, enabled)
        VALUES (1, 'trip_invite', 'push', 0), (1, 'collab_message', 'push', 0),
               (1, 'collab_message', 'webpush', 1)`,
      ).run();
      sourceStatement(
        db,
        `INSERT INTO app_settings (key, value) VALUES
        ('notif_default_trip_invite_push', 'blocked'),
        ('notif_default_collab_message_push', 'off'),
        ('notif_default_collab_message_webpush', 'on')`,
      ).run();
      await boot();
      const preferences = () =>
        sourceStatement(
          db,
          "SELECT event_type, enabled FROM notification_channel_preferences WHERE user_id = 1 AND channel = 'push' ORDER BY event_type",
        ).all();
      const defaults = () =>
        sourceStatement(
          db,
          "SELECT key, value FROM app_settings WHERE key GLOB 'notif_default_*_push' ORDER BY key",
        ).all();
      expect(preferences()).toEqual([
        { event_type: 'collab_message', enabled: 1 },
        { event_type: 'trip_invite', enabled: 0 },
      ]);
      expect(defaults()).toEqual([
        { key: 'notif_default_collab_message_push', value: 'on' },
        { key: 'notif_default_trip_invite_push', value: 'blocked' },
      ]);
      sourceStatement(db, "DELETE FROM app_settings WHERE key = 'notif_default_trip_invite_push'").run();
      await boot();
      expect(defaults()).toEqual([{ key: 'notif_default_collab_message_push', value: 'on' }]);
    } finally {
      await orm.close(true);
    }
  });

  it('adopts the released custom v3 schema without rewriting protected state', async () => {
    const { orm, db, boot } = await openFixture(180);
    try {
      const checks = [
        'SELECT id, exchange_rate_source, exchange_rate_set_at FROM budget_items',
        'SELECT * FROM trip_members',
        'SELECT * FROM web_push_subscriptions',
        'SELECT * FROM trip_exchange_rates',
      ];
      const values = checks.map((query) => sourceStatement(db, query).all());
      await boot();
      expect(checks.map((query) => sourceStatement(db, query).all())).toEqual(values);
      expect(
        sourceStatement(db, "SELECT name FROM pragma_table_info('vacay_entries') WHERE name='fraction'").get(),
      ).toBeDefined();
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      await orm.close(true);
    }
  });

  it('adopts numeric fork 199 with artifacts already installed by custom v3', async () => {
    const { orm, db, boot } = await openFixture(199);
    try {
      const values = protectedRows(db);
      await boot();
      expect(protectedRows(db)).toEqual(values);
      expect(sourceStatement(db, 'SELECT version FROM schema_version').pluck().get()).toBe(200);
    } finally {
      await orm.close(true);
    }
  });

  it('leaves a numeric source intact after snapshot or final validation failure and retries on the same connection', async () => {
    vi.stubEnv('TREK_DB_PRE_MIGRATE_SNAPSHOT', 'true');
    const { orm, db, migrator, boot } = await openFixture(202);
    try {
      const originalCatalog = catalog(db);
      const originalValues = protectedRows(db);
      const checkOriginal = () => {
        expect(catalog(db)).toEqual(originalCatalog);
        expect(protectedRows(db)).toEqual(originalValues);
        expect(sourceStatement(db, 'SELECT version FROM schema_version').pluck().get()).toBe(202);
        expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      };
      const snapshot = path.join(path.dirname(db.name), 'pre-migrate-legacy-202-20261101T100000Z.db');
      fs.mkdirSync(snapshot);
      await expect(boot()).rejects.toThrow(/could not write a copy/);
      checkOriginal();
      fs.rmdirSync(snapshot);

      let fail = true;
      migrator.on('migrated', ({ name }) => {
        if (fail && name === FORK_RECONCILIATION) db.exec('UPDATE budget_item_members SET user_id = -1');
      });
      await expect(boot()).rejects.toThrow(/foreign key violation/);
      checkOriginal();
      fail = false;

      await boot();
      expect(protectedRows(db)).toEqual(originalValues);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      await orm.close(true);
    }
  });

  it('adopts the actual upstream 258 endpoint and retires old Push rows for explicit re-registration', async () => {
    const { orm, db, boot } = await openFixture(258);
    try {
      const nativePush = sourceStatement(db, 'SELECT * FROM push_subscriptions').all();
      expect(nativePush).toHaveLength(1);
      await boot();
      expect(sourceStatement(db, 'SELECT * FROM push_subscriptions').all()).toEqual([]);
      expect(sourceStatement(db, 'SELECT * FROM web_push_subscriptions').all()).toEqual([]);
      expect(sourceStatement(db, 'SELECT version FROM schema_version').pluck().get()).toBe(258);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      await orm.close(true);
    }
  });

  it('records a missing named receipt without replaying existing data backfills', async () => {
    const { orm, db, boot } = await openFixture(244);
    try {
      sourceStatement(db, "DELETE FROM fork_schema_migrations WHERE id = 'fork/enhanced-fx-v1'").run();
      const prior = protectedRows(db);
      await boot();
      expect(protectedRows(db)).toEqual(prior);
      expect(sourceStatement(db, 'SELECT id FROM fork_schema_migrations ORDER BY id').pluck().all()).toEqual(
        [...FORK_SCHEMA_MIGRATION_IDS].sort(),
      );
    } finally {
      await orm.close(true);
    }
  });

  it('refuses direct ORM CLI replay of a positional source', async () => {
    const { orm, db } = await openFixture(202);
    try {
      const before = catalog(db);
      await expect(new TrekCliMigrator(orm.em).up()).rejects.toThrow(/must upgrade through TREK startup/);
      expect(catalog(db)).toEqual(before);
    } finally {
      await orm.close(true);
    }
  });

  it.each(['web_push_subscriptions', 'trip_exchange_rates'] as const)(
    'rejects a claimed fork table with its required constraints missing (%s)',
    async (table) => {
      const { orm, db, boot } = await openFixture(244);
      try {
        db.exec(
          `CREATE TABLE unconstrained AS SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE unconstrained RENAME TO ${table}`,
        );
        const before = catalog(db);
        await expect(boot()).rejects.toThrow(/Unrecognized or incomplete fork migration/);
        expect(catalog(db)).toEqual(before);
      } finally {
        await orm.close(true);
      }
    },
  );

  it('refuses a mixed numeric source before snapshot or ledger creation', async () => {
    vi.stubEnv('TREK_DB_PRE_MIGRATE_SNAPSHOT', 'true');
    const { orm, db, boot } = await openFixture(202);
    try {
      db.exec("ALTER TABLE reservations ADD COLUMN ingest_state TEXT NOT NULL DEFAULT 'live'");
      const before = catalog(db);
      await expect(boot()).rejects.toThrow(/schema artifacts do not prove a supported/);
      expect(catalog(db)).toEqual(before);
      expect(fs.readdirSync(path.dirname(db.name)).some((name) => name.startsWith('pre-migrate-'))).toBe(false);
    } finally {
      await orm.close(true);
    }
  });
});
