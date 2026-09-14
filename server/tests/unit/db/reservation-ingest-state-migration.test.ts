/**
 * Boot migration: reservations.ingest_state.
 *
 * The column gates the two anonymous exports (ICS feed, shared trip) so an
 * automated ingest can park a booking for review without publishing it. Every
 * row that exists before the ALTER has to come out 'live', or the migration
 * would empty a calendar subscription that works today.
 */
import { runMigrations } from '../../../src/db/migrations';
import { createTables } from '../../../src/db/schema';

import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';

function dbWithReservations(): Database.Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  createTables(db);
  db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'u', 'u@example.test', 'x')").run();
  db.prepare("INSERT INTO trips (id, user_id, title) VALUES (1, 1, 'T')").run();
  db.prepare("INSERT INTO reservations (id, trip_id, title, type) VALUES (1, 1, 'Old Flight', 'flight')").run();
  return db;
}

describe('reservations ingest_state migration', () => {
  it('MIGRATE-INGEST-001: every pre-existing row comes out live', () => {
    const db = dbWithReservations();
    try {
      runMigrations(db);
      const row = db.prepare('SELECT ingest_state FROM reservations WHERE id = 1').get() as { ingest_state: string };
      expect(row.ingest_state).toBe('live');
    } finally {
      db.close();
    }
  });

  it('MIGRATE-INGEST-002: running the migration twice is a no-op', () => {
    const db = dbWithReservations();
    try {
      runMigrations(db);
      // A second boot uses the already-applied lineage; lowering only metadata
      // would manufacture a mixed schema rather than reproduce a real restart.
      const version = (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version;
      runMigrations(db);

      const cols = db.prepare("SELECT name FROM pragma_table_info('reservations') WHERE name = 'ingest_state'").all();
      expect(cols).toHaveLength(1);
      expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(version);
    } finally {
      db.close();
    }
  });
});
