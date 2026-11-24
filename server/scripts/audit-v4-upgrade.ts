import { FORK_RECONCILIATION, FORK_SCHEMA_MIGRATION_IDS, hasTable, readForkLedger } from '../src/db/fork-migrations';
import { knownMigrationNames, unknownMigrations } from '../src/db/known-migrations';
import { inspectMigrationLineage } from '../src/db/legacy-baseline';

import Database from 'better-sqlite3';
import path from 'node:path';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = path.resolve(argument('--db') ?? process.env.TREK_DB_FILE ?? path.join(__dirname, '../data/travel.db'));
try {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const lineage = inspectMigrationLineage(db);
    const known = knownMigrationNames();
    const recorded = new Set(lineage.kind === 'orm' ? lineage.executed : []);
    const missingOrmMigrations = [...known].filter((name) => !recorded.has(name));
    const unknownOrmMigrations = unknownMigrations(recorded, known);
    const forkMigrations = readForkLedger(db);
    const missingForkMigrations = FORK_SCHEMA_MIGRATION_IDS.filter(
      (id) => !forkMigrations.some((row) => row.id === id),
    );
    const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
    const foreignKeyFailures = db.pragma('foreign_key_check');
    const healthy = integrity.every((row) => row.integrity_check === 'ok') && !foreignKeyFailures.length;
    const ready =
      healthy &&
      recorded.has(FORK_RECONCILIATION) &&
      !missingForkMigrations.length &&
      !missingOrmMigrations.length &&
      !unknownOrmMigrations.length;
    const rowCounts = Object.fromEntries(
      [
        'users',
        'trips',
        'trip_members',
        'reservations',
        'budget_items',
        'budget_item_members',
        'budget_settlements',
        'trip_exchange_rates',
        'global_exchange_rate_snapshots',
        'exchange_rate_batch_previews',
        'web_push_subscriptions',
        'push_subscriptions',
        'settings',
        'plugins',
      ].map((table) => [
        table,
        hasTable(db, table) ? db.prepare(`SELECT COUNT(*) FROM "${table}"`).pluck().get() : null,
      ]),
    );

    console.log(
      JSON.stringify(
        {
          database: file,
          lineage,
          ready,
          forkMigrations,
          missingForkMigrations,
          missingOrmMigrations,
          unknownOrmMigrations,
          integrity,
          foreignKeyFailures,
          rowCounts,
        },
        null,
        2,
      ),
    );

    if (!healthy || unknownOrmMigrations.length || (process.argv.includes('--require-current') && !ready)) {
      process.exitCode = 2;
    }
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
