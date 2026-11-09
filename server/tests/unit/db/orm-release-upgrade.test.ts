import { FORK_RECONCILIATION, FORK_TIMING_MIGRATION } from '../../../src/db/fork-migrations';
import { BootstrapMigrator, migrateToHead } from '../../../src/db/legacy-baseline';
import { openLegacyFixture, removeLegacyFixtureFiles } from '../../helpers/legacy-fixture';
import { MikroORM } from '@mikro-orm/sqlite';

import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const migrations = path.join(__dirname, '../../../src/db/migrations');
const additions = [
  'Migration20200101046330_an_object_no_row_names_is_marked_before_it_goes',
  'Migration20200101046340_a_released_object_outlasts_every_undo_before_it_goes',
  'Migration20200101046350_a_place_lies_on_the_real_world',
  'Migration20200101046360_a_new_install_starts_with_more_addons_on',
];
const directories: string[] = [];
const projections = [
  'SELECT * FROM fork_schema_migrations ORDER BY id',
  'SELECT id, user_id, new_member_identity_check_completed_at FROM trip_members ORDER BY id',
  'SELECT id, total_price, exchange_rate, exchange_rate_source, exchange_rate_set_at FROM budget_items ORDER BY id',
  'SELECT id, amount, exchange_rate, exchange_rate_source FROM budget_settlements ORDER BY id',
  'SELECT * FROM trip_exchange_rates ORDER BY trip_id,currency',
  'SELECT * FROM global_exchange_rate_snapshots ORDER BY base_currency',
  'SELECT * FROM exchange_rate_batch_previews ORDER BY id',
  'SELECT * FROM web_push_subscriptions ORDER BY id',
  'SELECT id, timing_json FROM days ORDER BY id',
  'SELECT id, stay_minutes, times_explicit, assignment_time, assignment_end_time FROM day_assignments ORDER BY id',
  'SELECT id,reservation_time,reservation_end_time FROM reservations ORDER BY id',
];
function statement(db: Database.Database, query: string) {
  // test-sql-allow: compares released schema values before current ORM entities are loaded.
  return db.prepare(query);
}
function values(db: Database.Database) {
  return projections.map((query) => statement(db, query).all());
}
async function open(file: string, catalog: string) {
  const orm = await MikroORM.init({
    entities: [],
    discovery: { warnWhenNoEntities: false },
    migrations: { path: catalog, pathTs: catalog, snapshot: false, silent: true },
    dbName: file,
  });
  const connection = orm.em.getConnection();
  return { orm, connection, db: await connection.getNativeClient(), migrator: new BootstrapMigrator(orm.em) };
}
afterEach(() => {
  removeLegacyFixtureFiles();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('upgrading the released ORM catalog to v5.1.1', () => {
  it('runs each new full name independently and preserves all five fork identities through two boots', async () => {
    const oldCatalog = fs.mkdtempSync(path.join(path.dirname(migrations), '.old-orm-catalog-'));
    directories.push(oldCatalog);
    for (const name of fs.readdirSync(migrations)) {
      if (!name.endsWith('.ts') || additions.some((added) => name === `${added}.ts`)) continue;
      fs.symlinkSync(path.join(migrations, name), path.join(oldCatalog, name));
    }
    const fixture = openLegacyFixture('fork-v244-itinerary');
    const file = fixture.name;
    fixture.close();
    const previous = await open(file, oldCatalog);
    let before: unknown;
    try {
      await migrateToHead(previous.connection, previous.migrator);
      const executed = statement(previous.db, 'SELECT name FROM mikro_orm_migrations').pluck().all();
      expect(executed).toContain(FORK_RECONCILIATION);
      expect(executed).toContain(FORK_TIMING_MIGRATION);
      for (const name of additions) expect(executed).not.toContain(name);
      expect(statement(previous.db, 'SELECT id FROM fork_schema_migrations').all()).toHaveLength(5);
      before = values(previous.db);
    } finally {
      await previous.orm.close(true);
    }
    const current = await open(file, migrations);
    try {
      expect((await current.migrator.getPending()).map((migration) => migration.name)).toEqual(additions);
      await migrateToHead(current.connection, current.migrator);
      expect(values(current.db)).toEqual(before);
      expect(current.db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(current.db.pragma('foreign_key_check')).toEqual([]);
      expect(await current.migrator.getPending()).toEqual([]);
      const executed = statement(current.db, 'SELECT name FROM mikro_orm_migrations').pluck().all();
      expect(executed).toEqual(expect.arrayContaining([...additions, FORK_RECONCILIATION, FORK_TIMING_MIGRATION]));
      await migrateToHead(current.connection, current.migrator);
      expect(values(current.db)).toEqual(before);
      expect(await current.migrator.getPending()).toEqual([]);
    } finally {
      await current.orm.close(true);
    }
  });
});
