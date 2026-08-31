import { FORK_SCHEMA_MIGRATION_IDS, UPSTREAM_SCHEMA_VERSION } from '../src/db/fork-migrations';

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dbPath = path.resolve(argument('--db') ?? process.env.TREK_DB_FILE ?? path.join(__dirname, '../data/travel.db'));
if (!fs.existsSync(dbPath)) {
  console.error(`Database does not exist: ${dbPath}`);
  process.exit(2);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const hasTable = (table: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const hasColumn = (table: string, column: string): boolean =>
  hasTable(table) && !!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column);
const rowCount = (table: string): number | null =>
  hasTable(table)
    ? Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
    : null;

const upstreamSchemaVersion = hasTable('schema_version')
  ? Number(
      (db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version?: number } | undefined)?.version ??
        0,
    )
  : 0;

const officialArtifacts: Array<[string, boolean]> = [
  ['vacay_entries.fraction', hasColumn('vacay_entries', 'fraction')],
  ['vacay_shares', hasTable('vacay_shares')],
  ['place_ratings', hasTable('place_ratings')],
  ['collection_place_ratings', hasTable('collection_place_ratings')],
  ['day_assignments.leg_transport_mode', hasColumn('day_assignments', 'leg_transport_mode')],
  ['days.default_transport_mode', hasColumn('days', 'default_transport_mode')],
  ['vacay_plans.school_holidays_enabled', hasColumn('vacay_plans', 'school_holidays_enabled')],
  ['vacay_holiday_calendars.type', hasColumn('vacay_holiday_calendars', 'type')],
  ['reservations.ingest_state', hasColumn('reservations', 'ingest_state')],
  ['mcp_tokens.kind', hasColumn('mcp_tokens', 'kind')],
];

const customArtifacts: Array<[string, boolean]> = [
  ['global_exchange_rate_snapshots', hasTable('global_exchange_rate_snapshots')],
  ['trip_exchange_rates', hasTable('trip_exchange_rates')],
  ['exchange_rate_batch_previews', hasTable('exchange_rate_batch_previews')],
  ['budget_items.exchange_rate_source', hasColumn('budget_items', 'exchange_rate_source')],
  ['budget_settlements.exchange_rate_source', hasColumn('budget_settlements', 'exchange_rate_source')],
  [
    'trip_members.new_member_identity_check_completed_at',
    hasColumn('trip_members', 'new_member_identity_check_completed_at'),
  ],
  ['web_push_subscriptions', hasTable('web_push_subscriptions')],
];

const missingOfficialArtifacts = officialArtifacts.filter(([, present]) => !present).map(([name]) => name);
const missingCustomArtifacts = customArtifacts.filter(([, present]) => !present).map(([name]) => name);
const hasAnyCustomArtifact = customArtifacts.some(([, present]) => present);

const forkMigrations = hasTable('fork_schema_migrations')
  ? (db.prepare('SELECT id, applied_at FROM fork_schema_migrations ORDER BY applied_at, id').all() as Array<{
      id: string;
      applied_at: string;
    }>)
  : [];
const forkMigrationIds = forkMigrations.map((row) => row.id);
const missingForkMigrations = FORK_SCHEMA_MIGRATION_IDS.filter((id) => !forkMigrationIds.includes(id));
const unknownForkMigrations = forkMigrationIds.filter(
  (id) => !(FORK_SCHEMA_MIGRATION_IDS as readonly string[]).includes(id),
);

const official199 = hasColumn('reservations', 'ingest_state');
const official200 = hasColumn('mcp_tokens', 'kind');
const crosswalk = officialArtifacts.slice(0, 8).every(([, present]) => present);
const enhancedFx = customArtifacts.slice(0, 5).every(([, present]) => present);
const guestIdentity = customArtifacts[5][1];
const webPush = customArtifacts[6][1];
const legacyForkNumeric =
  forkMigrations.length === 0 &&
  ((upstreamSchemaVersion === 199 && crosswalk && !official199) ||
    (upstreamSchemaVersion === 200 && crosswalk && enhancedFx && !official200) ||
    (upstreamSchemaVersion === 201 && crosswalk && enhancedFx && guestIdentity) ||
    (upstreamSchemaVersion === 202 && crosswalk && enhancedFx && guestIdentity && webPush));

type Classification =
  | 'clean-3.4.x'
  | 'custom-3.4.1'
  | 'official-v4.0'
  | 'official-v4.1'
  | 'legacy-fork-numeric'
  | 'dual-lineage-v4.1'
  | 'mixed-or-unsupported';

let classification: Classification;
if (upstreamSchemaVersion <= 175 && !hasAnyCustomArtifact) classification = 'clean-3.4.x';
else if (upstreamSchemaVersion >= 176 && upstreamSchemaVersion <= 180 && hasAnyCustomArtifact)
  classification = 'custom-3.4.1';
else if (legacyForkNumeric) classification = 'legacy-fork-numeric';
else if (upstreamSchemaVersion === 198 && crosswalk && forkMigrations.length === 0) classification = 'official-v4.0';
else if (
  upstreamSchemaVersion >= 199 &&
  upstreamSchemaVersion <= UPSTREAM_SCHEMA_VERSION &&
  crosswalk &&
  official199 &&
  (upstreamSchemaVersion < 200 || official200) &&
  forkMigrations.length === 0
)
  classification = 'official-v4.1';
else if (
  upstreamSchemaVersion === UPSTREAM_SCHEMA_VERSION &&
  missingOfficialArtifacts.length === 0 &&
  missingCustomArtifacts.length === 0 &&
  missingForkMigrations.length === 0 &&
  unknownForkMigrations.length === 0
)
  classification = 'dual-lineage-v4.1';
else classification = 'mixed-or-unsupported';

const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
const foreignKeyFailures = db.pragma('foreign_key_check') as Array<Record<string, unknown>>;
const report = {
  database: dbPath,
  classification,
  upstreamSchemaVersion,
  expectedUpstreamSchemaVersion: UPSTREAM_SCHEMA_VERSION,
  forkMigrations,
  missingForkMigrations,
  unknownForkMigrations,
  missingOfficialArtifacts,
  missingCustomArtifacts,
  integrity: integrity.map((row) => row.integrity_check),
  foreignKeyFailures,
  rowCounts: {
    users: rowCount('users'),
    trips: rowCount('trips'),
    tripMembers: rowCount('trip_members'),
    reservations: rowCount('reservations'),
    budgetItems: rowCount('budget_items'),
    budgetSettlements: rowCount('budget_settlements'),
    tripExchangeRates: rowCount('trip_exchange_rates'),
    globalExchangeRateSnapshots: rowCount('global_exchange_rate_snapshots'),
    exchangeRateBatchPreviews: rowCount('exchange_rate_batch_previews'),
    webPushSubscriptions: rowCount('web_push_subscriptions'),
    settings: rowCount('settings'),
    plugins: rowCount('plugins'),
  },
};

console.log(JSON.stringify(report, null, 2));
db.close();

if (
  classification === 'mixed-or-unsupported' ||
  integrity.some((row) => row.integrity_check !== 'ok') ||
  foreignKeyFailures.length > 0
) {
  process.exitCode = 2;
}
