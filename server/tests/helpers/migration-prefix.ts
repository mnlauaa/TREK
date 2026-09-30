import Database from 'better-sqlite3';
import { vi } from 'vitest';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';

/** Build a real historical schema by stopping after the requested migration commits. */
export function createMigrationPrefix(version: number): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createTables(db);
  const stopped = new Error('migration prefix complete');
  const transaction = db.transaction.bind(db);
  const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation(((fn: () => unknown) => {
    const run = transaction(fn);
    return (...args: unknown[]) => {
      const result = run(...args);
      const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
      if (row.version === version) throw stopped;
      return result;
    };
  }) as typeof db.transaction);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw stopped; });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    runMigrations(db);
  } catch (error) {
    if (error !== stopped) { db.close(); throw error; }
  } finally {
    transactionSpy.mockRestore();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
  if (row.version !== version) { db.close(); throw new Error(`Expected schema ${version}, got ${row.version}`); }
  return db;
}
