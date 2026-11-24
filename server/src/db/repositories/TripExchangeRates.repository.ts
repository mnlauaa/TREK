import type { TripExchangeRates } from '../entities/TripExchangeRates.entity';
import type { DB } from '../kysely/db';
import { TrekRepository } from './_shared/trek-repository';

import type { Selectable } from 'kysely';

export class TripExchangeRatesRepository extends TrekRepository<TripExchangeRates> {
  private rates() {
    return this.kysely<Pick<DB, 'trip_exchange_rates'>>();
  }

  async listForTrip(tripId: number) {
    return this.rates()
      .selectFrom('trip_exchange_rates')
      .selectAll()
      .where('trip_id', '=', tripId)
      .orderBy('currency')
      .execute();
  }

  async getRate(tripId: number, currency: string) {
    return this.rates()
      .selectFrom('trip_exchange_rates')
      .selectAll()
      .where('trip_id', '=', tripId)
      .where('currency', '=', currency)
      .executeTakeFirst();
  }

  async saveRate(row: Selectable<DB['trip_exchange_rates']>) {
    return this.rates()
      .insertInto('trip_exchange_rates')
      .values(row)
      .onConflict((oc) => oc.columns(['trip_id', 'currency']).doUpdateSet(row))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deleteRate(tripId: number, currency: string): Promise<boolean> {
    const result = await this.rates()
      .deleteFrom('trip_exchange_rates')
      .where('trip_id', '=', tripId)
      .where('currency', '=', currency)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }
}
