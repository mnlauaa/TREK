import type { NativeSqliteDatabase } from './connection';
import {
  classifyPositionalLineage,
  FORK_RECONCILIATION,
  FORK_SCHEMA_MIGRATION_IDS,
  hasColumn,
  hasTable,
  normalizeNumericFork,
  readForkLedger,
  type PositionalLineage,
} from './fork-migrations';
import { knownMigrationNames, unknownMigrations } from './known-migrations';
import type { MigrationInfo } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import type { SqlEntityManager } from '@mikro-orm/sql';
import type { SqliteConnection } from '@mikro-orm/sqlite';

import fs from 'node:fs';

const STEP_MARKER = /Legacy migration step (\d+)\b/g;

export const REFUSAL = '[DB] Refusing to boot:';

/**
 * What the boot does around a migration run (`pre-migrate-snapshot.ts` in
 * production, nothing in the unit tests and on a restore).
 */
export interface MigrationSafetyNet {
  /**
   * Runs after the plan is known and before anything is written, only when
   * something is pending. `from` labels the schema the database holds: the
   * last recorded migration's timestamp, `legacy-<schema_version>`, or null
   * when nothing is recorded at all. Throwing refuses the boot.
   */
  beforeMigrate(from: string | null): Promise<void>;
  /** A sentence pointing at a copy this release can run, for the newer-database refusal. */
  restoreHint(thisRelease: string): Promise<string | null>;
}

export const NO_SAFETY_NET: MigrationSafetyNet = {
  beforeMigrate: async () => {},
  restoreHint: async () => null,
};

/** The part of a migration name that orders it: what a schema state is labelled by. */
export function migrationLabel(name: string): string {
  return /^Migration(\d+)_/.exec(name)?.[1] ?? name;
}

function latest(names: Iterable<string>): string | null {
  let last: string | null = null;
  for (const name of names) if (last === null || name > last) last = name;
  return last;
}

export interface LegacyStepMap {
  /** The migrations standing for `createTables()`: everything that sorts ahead of step 1. */
  baseline: string[];
  /** Legacy step number → the migration that carries it. */
  steps: Map<number, string>;
  /** The last step the positional runner ever had. */
  finalStep: number;
}

type ReadSource = (path: string) => string;

const readFromDisk: ReadSource = (path) => fs.readFileSync(path, 'utf8');

function stepsNamedIn(migration: MigrationInfo, readSource: ReadSource): number[] {
  if (!migration.path) {
    throw new Error(`${REFUSAL} migration ${migration.name} has no source file to read its legacy step from`);
  }
  const found = new Set<number>();
  for (const match of readSource(migration.path).matchAll(STEP_MARKER)) found.add(Number(match[1]));
  return [...found];
}

/**
 * Derives the legacy step → migration map from the migrations the migrator
 * discovered, in its own application order.
 *
 * Throws unless the mapping is exact: one step per migration at most, no step
 * claimed twice, steps 1..N all present, and applied in step order — the order
 * the positional runner used, which is the only order that reproduces what an
 * install at step N already has.
 */
export function buildLegacyStepMap(
  migrations: readonly MigrationInfo[],
  readSource: ReadSource = readFromDisk,
): LegacyStepMap {
  const steps = new Map<number, string>();
  let previousStep = 0;
  let firstNumbered = -1;
  migrations.forEach((migration, index) => {
    const named = stepsNamedIn(migration, readSource);
    if (named.length === 0) return;
    if (named.length > 1) {
      throw new Error(`${REFUSAL} ${migration.name} names more than one legacy step (${named.join(', ')})`);
    }
    const [step] = named as [number];
    const owner = steps.get(step);
    if (owner) throw new Error(`${REFUSAL} legacy step ${step} is claimed by both ${owner} and ${migration.name}`);
    if (step < previousStep) {
      throw new Error(`${REFUSAL} ${migration.name} (legacy step ${step}) sorts after legacy step ${previousStep}`);
    }
    if (firstNumbered < 0) firstNumbered = index;
    previousStep = step;
    steps.set(step, migration.name);
  });

  const finalStep = steps.size;
  if (finalStep === 0) throw new Error(`${REFUSAL} no migration names a legacy step`);
  for (let step = 1; step <= finalStep; step++) {
    if (!steps.has(step)) throw new Error(`${REFUSAL} no migration carries legacy step ${step}`);
  }
  const baseline = migrations.slice(0, firstNumbered).map((migration) => migration.name);
  if (baseline.length === 0) throw new Error(`${REFUSAL} no baseline migration sorts ahead of legacy step 1`);
  return { baseline, steps, finalStep };
}

export class TrekCliMigrator extends Migrator {
  static override register(orm: Parameters<typeof Migrator.register>[0]): void {
    orm.config.registerExtension('@mikro-orm/migrator', () => new TrekCliMigrator(orm.em as SqlEntityManager));
  }

  override async init(): Promise<void> {
    const db = await (this.driver.getConnection() as SqliteConnection).getNativeClient();
    if (inspectMigrationLineage(db).kind === 'positional') {
      throw new Error(
        `${REFUSAL} positional databases must upgrade through TREK startup, which checks the lineage and takes a snapshot.`,
      );
    }
    await super.init();
  }
}

export class BootstrapMigrator extends Migrator {
  override async init(): Promise<void> {
    // The boot already opened SQLite. Stock init can create its ledger outside the transaction.
    await this.initPaths();
  }

  async manifest(): Promise<MigrationInfo[]> {
    await this.init();
    return this.discoverMigrations();
  }

  resetAfterRollback(): void {
    // MigrationStorage caches successful ledger creation even if SQLite rolled it back.
    this.initServices();
  }
}

type MigrationLineage =
  | { kind: 'fresh' }
  | { kind: 'orm'; executed: string[] }
  | { kind: 'positional'; recordedStep: number; lineage: PositionalLineage };

export function inspectMigrationLineage(db: NativeSqliteDatabase, finalStep = 258): MigrationLineage {
  const forkLedger = readForkLedger(db);
  const executed = hasTable(db, 'mikro_orm_migrations')
    ? (db.prepare('SELECT name FROM mikro_orm_migrations ORDER BY id').all() as { name: string }[]).map(({ name }) =>
        name.replace(/\.[jt]s$/, ''),
      )
    : [];
  if (new Set(executed).size !== executed.length) throw new Error(`${REFUSAL} duplicate ORM migration names`);
  if (executed.length > 0) {
    if (
      executed.includes(FORK_RECONCILIATION) &&
      (forkLedger.length !== FORK_SCHEMA_MIGRATION_IDS.length ||
        !hasColumn(db, 'trip_members', 'new_member_identity_check_completed_at'))
    ) {
      throw new Error(`${REFUSAL} fork reconciliation is recorded without its complete fork ledger and schema`);
    }
    return { kind: 'orm', executed };
  }

  if (!hasTable(db, 'schema_version')) {
    if (forkLedger.length) throw new Error(`${REFUSAL} fork ledger without migration history`);
    return { kind: 'fresh' };
  }
  const rows = db.prepare('SELECT version FROM schema_version').all() as { version: unknown }[];
  if (rows.length !== 1) {
    throw new Error(`${REFUSAL} schema_version holds ${rows.length} rows; the legacy runner always kept exactly one`);
  }
  const [{ version }] = rows as [{ version: unknown }];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`${REFUSAL} schema_version ${String(version)} is not a legacy step this release can map`);
  }
  if (version > finalStep) {
    throw new Error(
      `${REFUSAL} schema_version ${version} is newer than the last legacy step this release knows (${finalStep})`,
    );
  }
  return { kind: 'positional', recordedStep: version, lineage: classifyPositionalLineage(db, version) };
}

function legacyBaseline(lineage: MigrationLineage, manifest: MigrationInfo[], readSource: ReadSource): string[] {
  if (lineage.kind !== 'positional') return [];
  const map = buildLegacyStepMap(manifest, readSource);
  const { upstreamStep } = lineage.lineage;
  if (upstreamStep > map.finalStep) {
    throw new Error(
      `${REFUSAL} schema_version ${upstreamStep} is newer than the last legacy step this release knows (${map.finalStep})`,
    );
  }
  return [...map.steps].filter(([step]) => step <= upstreamStep).map(([, name]) => name);
}

export async function planLegacyBaseline(
  connection: SqliteConnection,
  migrator: BootstrapMigrator,
  readSource: ReadSource = readFromDisk,
): Promise<string[]> {
  const manifest = await migrator.manifest();
  return legacyBaseline(inspectMigrationLineage(await connection.getNativeClient()), manifest, readSource);
}

const activeBoots = new WeakMap<SqliteConnection, Promise<void>>();

export async function migrateToHead(
  connection: SqliteConnection,
  migrator: BootstrapMigrator,
  readSource: ReadSource = readFromDisk,
  known: Set<string> = knownMigrationNames(),
  safetyNet: MigrationSafetyNet = NO_SAFETY_NET,
): Promise<void> {
  const active = activeBoots.get(connection);
  if (active !== undefined) return active;
  const migration = applyMigrations(connection, migrator, readSource, known, safetyNet);
  activeBoots.set(connection, migration);
  try {
    await migration;
  } finally {
    activeBoots.delete(connection);
  }
}

async function applyMigrations(
  connection: SqliteConnection,
  migrator: BootstrapMigrator,
  readSource: ReadSource,
  known: Set<string>,
  safetyNet: MigrationSafetyNet,
): Promise<void> {
  const db = await connection.getNativeClient();
  const manifest = await migrator.manifest();
  const state = () => ({
    lineage: inspectMigrationLineage(db),
    schemaVersion: db.pragma('schema_version', { simple: true }),
    dataVersion: db.pragma('data_version', { simple: true }),
  });
  const before = state();
  const { lineage } = before;
  const executed = lineage.kind === 'orm' ? lineage.executed : [];
  if (unknownMigrations(executed, known).length > 0) {
    const thisRelease = latest(known);
    refuseNewerDatabase(executed, known, thisRelease ? await safetyNet.restoreHint(migrationLabel(thisRelease)) : null);
  }
  const baselined = legacyBaseline(lineage, manifest, readSource);
  if (lineage.kind === 'positional') {
    console.log(
      `[DB] Legacy install at schema_version ${lineage.recordedStep} — baselining ${baselined.length} migration(s)`,
    );
  }
  const already = new Set([...baselined, ...executed]);
  const pending = manifest.filter(({ name }) => !already.has(name));
  if (pending.length === 0 && baselined.length === 0) return;
  const lastRecorded = latest(executed);
  await safetyNet.beforeMigrate(
    lastRecorded !== null
      ? migrationLabel(lastRecorded)
      : lineage.kind === 'positional'
        ? `legacy-${lineage.recordedStep}`
        : null,
  );

  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    await connection.transactional(async (trx) => {
      if (JSON.stringify(state()) !== JSON.stringify(before)) {
        throw new Error(`${REFUSAL} the database changed after the migration plan was prepared. Retry boot.`);
      }
      if (lineage.kind === 'positional' && lineage.lineage.kind === 'numeric-fork') normalizeNumericFork(db);
      const storage = migrator.getStorage();
      storage.setMasterMigration(trx);
      try {
        await storage.ensureTable();
        await baselined.reduce(
          (previous, name) => previous.then(() => storage.logMigration({ name }, trx)),
          Promise.resolve(),
        );
      } finally {
        storage.unsetMasterMigration();
      }
      console.log(`[DB] Applying ${pending.length} pending migration(s)`);
      await migrator.up({ transaction: trx });
      const invalid = db.pragma('foreign_key_check') as { table: string; rowid: number | null }[];
      if (invalid.length) {
        const [{ table, rowid }] = invalid as [(typeof invalid)[number]];
        throw new Error(
          `${REFUSAL} ${invalid.length} foreign key violation(s) after migration; first in ${table} row ${rowid}`,
        );
      }
    });
  } catch (error) {
    migrator.resetAfterRollback();
    throw error;
  } finally {
    db.pragma(foreignKeys ? 'foreign_keys = ON' : 'foreign_keys = OFF');
  }
}

/**
 * A database a newer TREK migrated carries migrations this build does not
 * ship; so does one a feature-branch build migrated, which is why the message
 * names both. An image rolled back, or a newer backup restored, would otherwise run
 * older code against a schema it does not know and fail later, far from the
 * cause. Refused before anything is written.
 */
export function refuseNewerDatabase(executed: string[], known: Set<string>, restoreHint: string | null = null): void {
  const unknown = unknownMigrations(executed, known);
  if (unknown.length === 0) return;
  throw new Error(
    `${REFUSAL} the database was migrated by a newer TREK (${unknown.length} unknown migration(s), latest ${unknown[unknown.length - 1]}), ` +
      'or by a development build that added migrations of its own. ' +
      'Run that version again, or restore a backup taken with this one.' +
      (restoreHint ? ` ${restoreHint}` : ''),
  );
}
