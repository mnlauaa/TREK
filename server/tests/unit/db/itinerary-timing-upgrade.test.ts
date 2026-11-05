import { FORK_RECONCILIATION, FORK_TIMING_MIGRATION } from '../../../src/db/fork-migrations';
import { BootstrapMigrator, migrateToHead } from '../../../src/db/legacy-baseline';
import { openLegacyFixture, removeLegacyFixtureFiles } from '../../helpers/legacy-fixture';
import { MikroORM } from '@mikro-orm/sqlite';

import type Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const migrations = path.join(__dirname, '../../../src/db/migrations');
const directories: string[] = [];
function source(db: Database.Database, query: string) {
  // test-sql-allow: verifies historical schema values before current entities are valid.
  return db.prepare(query);
}
async function open(name?: 'fork-v244' | 'fork-v244-itinerary') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trek-timing-upgrade-'));
  directories.push(dir);
  let file = path.join(dir, 'fresh.db');
  if (name) {
    const db = openLegacyFixture(name);
    file = db.name;
    db.close();
  }
  const orm = await MikroORM.init({
    entities: [],
    discovery: { warnWhenNoEntities: false },
    migrations: { path: migrations, pathTs: migrations, snapshot: false, silent: true },
    dbName: file,
  });
  const connection = orm.em.getConnection();
  const db = await connection.getNativeClient();
  const migrator = new BootstrapMigrator(orm.em);
  const boot = () => migrateToHead(connection, migrator);
  return { orm, db, boot, migrator };
}
afterEach(() => {
  removeLegacyFixtureFiles();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const queries = [
  'SELECT id, timing_json FROM days ORDER BY id',
  'SELECT id, stay_minutes, times_explicit, assignment_time, assignment_end_time FROM day_assignments ORDER BY id',
  'SELECT id,reservation_time,reservation_end_time FROM reservations ORDER BY id',
  'SELECT * FROM fork_schema_migrations ORDER BY id',
];
function values(db: Database.Database) {
  return queries.map((query) => source(db, query).all());
}
describe('current release itinerary upgrade', () => {
  it('preserves populated five-ID release data and reruns unchanged', async () => {
    const { orm, db, boot } = await open('fork-v244-itinerary');
    try {
      const before = values(db);
      await boot();
      expect(values(db)).toEqual(before);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(source(db, 'SELECT name FROM mikro_orm_migrations').pluck().all()).toContain(FORK_TIMING_MIGRATION);
      await boot();
      expect(values(db)).toEqual(before);
    } finally {
      await orm.close(true);
    }
  });
  it('opts existing pre-feature days out and enables newly created days once', async () => {
    const { orm, db, boot } = await open('fork-v244');
    try {
      source(db, 'INSERT INTO days (trip_id,day_number) VALUES (1,1)').run();
      await boot();
      expect(
        JSON.parse(source(db, 'SELECT timing_json FROM days WHERE day_number=1').pluck().get() as string).enabled,
      ).toBe(false);
      source(db, 'INSERT INTO days (trip_id,day_number) VALUES (1,2)').run();
      expect(
        JSON.parse(source(db, 'SELECT timing_json FROM days WHERE day_number=2').pluck().get() as string).enabled,
      ).toBe(true);
      await boot();
      expect(
        JSON.parse(source(db, 'SELECT timing_json FROM days WHERE day_number=2').pluck().get() as string).enabled,
      ).toBe(true);
    } finally {
      await orm.close(true);
    }
  });
  it('advances the previous four-ID ORM generation without rejecting its ledger', async () => {
    const { orm, db, boot, migrator } = await open();
    try {
      await migrator.up({ to: FORK_RECONCILIATION });
      const before = source(db, 'SELECT * FROM fork_schema_migrations ORDER BY id').all();
      expect(before).toHaveLength(4);
      await boot();
      expect(source(db, 'SELECT * FROM fork_schema_migrations ORDER BY id').all()).toEqual(
        expect.arrayContaining(before),
      );
      expect(source(db, 'SELECT id FROM fork_schema_migrations').all()).toHaveLength(5);
      await boot();
    } finally {
      await orm.close(true);
    }
  });
  it('installs timing on a fresh database', async () => {
    const { orm, db, boot } = await open();
    try {
      await boot();
      expect(source(db, 'SELECT id FROM fork_schema_migrations').pluck().all()).toContain('fork/itinerary-timing-v1');
      expect(source(db, "SELECT name FROM pragma_table_info('days')").pluck().all()).toContain('timing_json');
    } finally {
      await orm.close(true);
    }
  });
  it('rejects a fifth ledger row without its schema before any writes', async () => {
    const { orm, db, boot } = await open('fork-v244');
    try {
      source(db, 'INSERT INTO fork_schema_migrations (id) VALUES (?)').run('fork/itinerary-timing-v1');
      const before = db.serialize();
      await expect(boot()).rejects.toThrow('Unrecognized or incomplete fork migration');
      expect(db.serialize()).toEqual(before);
    } finally {
      await orm.close(true);
    }
  });
});
