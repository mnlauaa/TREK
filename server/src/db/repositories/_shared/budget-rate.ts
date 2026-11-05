import type { DB } from '../../kysely/db';

import type { Selectable } from 'kysely';

export type BudgetRateColumns = Pick<
  Selectable<DB['budget_items']>,
  | 'exchange_rate'
  | 'exchange_rate_source'
  | 'exchange_rate_source_version'
  | 'exchange_rate_effective_date'
  | 'exchange_rate_set_at'
  | 'exchange_rate_set_by_user_id'
  | 'exchange_rate_note'
  | 'exchange_rate_reset_at'
>;

export function budgetRateColumns(row: BudgetRateColumns): BudgetRateColumns {
  return {
    exchange_rate: row.exchange_rate,
    exchange_rate_source: row.exchange_rate_source,
    exchange_rate_source_version: row.exchange_rate_source_version,
    exchange_rate_effective_date: row.exchange_rate_effective_date,
    exchange_rate_set_at: row.exchange_rate_set_at,
    exchange_rate_set_by_user_id: row.exchange_rate_set_by_user_id,
    exchange_rate_note: row.exchange_rate_note,
    exchange_rate_reset_at: row.exchange_rate_reset_at,
  };
}
