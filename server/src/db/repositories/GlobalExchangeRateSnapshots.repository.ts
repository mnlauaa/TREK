import type { GlobalExchangeRateSnapshots } from '../entities/GlobalExchangeRateSnapshots.entity';
import type { DB } from '../kysely/db';
import { TrekRepository } from './_shared/trek-repository';

import type { Selectable } from 'kysely';

export class GlobalExchangeRateSnapshotsRepository extends TrekRepository<GlobalExchangeRateSnapshots> {
  private rates() {
    return this.kysely<Pick<DB, 'global_exchange_rate_snapshots'>>();
  }

  async getSnapshot(base: string) {
    return this.rates()
      .selectFrom('global_exchange_rate_snapshots')
      .selectAll()
      .where('base_currency', '=', base)
      .executeTakeFirst();
  }

  async saveSnapshot(row: Selectable<DB['global_exchange_rate_snapshots']>): Promise<void> {
    await this.rates()
      .insertInto('global_exchange_rate_snapshots')
      .values(row)
      .onConflict((oc) => oc.column('base_currency').doUpdateSet(row))
      .execute();
  }

  async listBases(): Promise<string[]> {
    const rows = await this.rates().selectFrom('global_exchange_rate_snapshots').select('base_currency').execute();
    return rows.map((row) => row.base_currency);
  }
}
