import { addColumn, hasColumn, hasItineraryTimingArtifacts, readForkLedger } from '../fork-migrations';
import { Migration } from '@mikro-orm/migrations';
import type { SqliteConnection } from '@mikro-orm/sqlite';

export class Migration20200101046340_adopt_itinerary_timing extends Migration {
  override async up(): Promise<void> {
    const db = await (this.driver.getConnection() as SqliteConnection).getNativeClient();
    if (!db.inTransaction) throw new Error('Itinerary timing adoption requires a transaction');
    const recorded = readForkLedger(db).some(({ id }) => id === 'fork/itinerary-timing-v1');
    if (recorded) return;
    addColumn(db, 'day_assignments', 'stay_minutes INTEGER CHECK(stay_minutes BETWEEN 0 AND 1440)');
    addColumn(db, 'day_assignments', 'times_explicit INTEGER NOT NULL DEFAULT 0');
    const hadTiming = hasColumn(db, 'days', 'timing_json');
    addColumn(db, 'days', `timing_json TEXT NOT NULL DEFAULT '{"enabled":true,"start":"09:00","travel":[]}'`);
    if (!hadTiming) db.exec(`UPDATE days SET timing_json = '{"enabled":false,"start":"09:00","travel":[]}'`);
    if (!hasItineraryTimingArtifacts(db)) throw new Error('Incomplete itinerary timing schema');
    db.prepare('INSERT INTO fork_schema_migrations (id) VALUES (?)').run('fork/itinerary-timing-v1');
  }
}
