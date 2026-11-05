import type { ExchangeRateBatchPreviews } from '../entities/ExchangeRateBatchPreviews.entity';
import type { DB } from '../kysely/db';
import type { BudgetRateColumns } from './_shared/budget-rate';
import { TrekRepository } from './_shared/trek-repository';
import type { ApplyTripExchangeRateRequest } from '@trek/shared';

import type { Insertable } from 'kysely';

type Selection = ApplyTripExchangeRateRequest['selected'];

export class ExchangeRateBatchPreviewsRepository extends TrekRepository<ExchangeRateBatchPreviews> {
  private previews() {
    return this.kysely<Pick<DB, 'exchange_rate_batch_previews' | 'budget_items' | 'budget_settlements'>>();
  }

  async getPreview(tripId: number, id: string) {
    return this.previews()
      .selectFrom('exchange_rate_batch_previews')
      .selectAll()
      .where('trip_id', '=', tripId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async savePreview(row: Insertable<DB['exchange_rate_batch_previews']>): Promise<void> {
    await this.previews().insertInto('exchange_rate_batch_previews').values(row).execute();
  }

  async deletePreview(id: string): Promise<void> {
    await this.previews().deleteFrom('exchange_rate_batch_previews').where('id', '=', id).execute();
  }

  async deleteExpired(cutoff: string): Promise<number> {
    const result = await this.previews()
      .deleteFrom('exchange_rate_batch_previews')
      .where('created_at', '<=', cutoff)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async batchRows(tripId: number, currency: string) {
    const expenses = await this.previews()
      .selectFrom('budget_items')
      .selectAll()
      .where('trip_id', '=', tripId)
      .where((eb) => eb(eb.fn<string>('upper', ['currency']), '=', currency))
      .orderBy('id')
      .execute();
    const settlements = await this.previews()
      .selectFrom('budget_settlements')
      .selectAll()
      .where('trip_id', '=', tripId)
      .where((eb) => eb(eb.fn<string>('upper', ['currency']), '=', currency))
      .orderBy('id')
      .execute();
    return {
      expenses,
      settlements,
    };
  }

  async applySelectedRates(tripId: number, selected: Selection, rate: BudgetRateColumns): Promise<void> {
    const expenses = selected.filter((row) => row.type === 'expense').map((row) => row.id);
    const settlements = selected.filter((row) => row.type === 'settlement').map((row) => row.id);
    if (expenses.length) {
      await this.previews()
        .updateTable('budget_items')
        .set(rate)
        .where('trip_id', '=', tripId)
        .where('id', 'in', expenses)
        .execute();
    }
    if (settlements.length) {
      await this.previews()
        .updateTable('budget_settlements')
        .set(rate)
        .where('trip_id', '=', tripId)
        .where('id', 'in', settlements)
        .execute();
    }
  }
}
