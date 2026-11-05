import { adoptForkMigrations } from '../fork-migrations';
import { Migration } from '@mikro-orm/migrations';
import type { SqliteConnection } from '@mikro-orm/sqlite';

export class Migration20200101046330_adopt_fork_schema_lineages extends Migration {
  override name = 'Migration20200101046330_adopt_fork_schema_lineages';

  override async up(): Promise<void> {
    const db = await (this.driver.getConnection() as SqliteConnection).getNativeClient();
    if (!db.inTransaction) throw new Error('Fork schema adoption requires a transaction');
    adoptForkMigrations(db);
  }
}
