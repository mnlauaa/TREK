import type { BudgetSettlements } from '../entities/BudgetSettlements.entity';
import type { DB } from '../kysely/db';
import type { BudgetRateColumns } from './_shared/budget-rate';
import { presenceSet } from './_shared/presence-set';
import { type AssertRowKeys } from './_shared/rows';
import { TrekRepository } from './_shared/trek-repository';

/** A bare `budget_settlements` row — every scalar column, incl. the `persist(false)` relation mirrors. */
export interface BudgetSettlementRow extends BudgetRateColumns {
  id: number;
  trip_id: number;
  from_user_id: number;
  to_user_id: number;
  amount: number;
  created_at: string | null;
  created_by_user_id: number | null;
  currency: string | null;
  settled_at: string | null;
  note: string | null;
}

const _budgetSettlementRowKeys: AssertRowKeys<BudgetSettlementRow, BudgetSettlements> = true;

/** `SETTLEMENT_SELECT`'s joined projection (BG76/77). */
export interface BudgetSettlementWithUsersRow extends BudgetSettlementRow {
  from_username: string;
  from_avatar: string | null;
  to_username: string;
  to_avatar: string | null;
}

type BudgetSettlementsKyselyDB = Pick<DB, 'budget_settlements' | 'users'>;

/**
 * The insert's table. `id`/`created_at` are autoincrement/`DEFAULT
 * CURRENT_TIMESTAMP` and omitted from `.values()` below (the legacy
 * statement's own column list omits them too); both are `InsertOptional`
 * in the generated type, so every SELECT still reads them as present.
 */
type BudgetSettlementsWriteKyselyDB = Pick<DB, 'budget_settlements'>;

/**
 * `budget_settlements` — recorded settle-up transfers. Kysely throughout,
 * same `persist(false)` reasoning as its sibling budget repositories.
 */
export class BudgetSettlementsRepository extends TrekRepository<BudgetSettlements> {
  private joinedQuery() {
    return this.kysely<BudgetSettlementsKyselyDB>()
      .selectFrom('budget_settlements as s')
      .innerJoin('users as fu', 'fu.id', 's.from_user_id')
      .innerJoin('users as tu', 'tu.id', 's.to_user_id')
      .selectAll('s')
      .select([
        (eb) => eb.fn.coalesce('fu.display_name', 'fu.username').as('from_username'),
        'fu.avatar as from_avatar',
        (eb) => eb.fn.coalesce('tu.display_name', 'tu.username').as('to_username'),
        'tu.avatar as to_avatar',
      ]);
  }

  /** BG76 (`listSettlements`) — `SETTLEMENT_SELECT WHERE s.trip_id = ? ORDER BY s.created_at DESC, s.id DESC`. */
  async listForTrip(trip_id: number | string): Promise<BudgetSettlementWithUsersRow[]> {
    return await this.joinedQuery()
      .where('s.trip_id', '=', trip_id as number)
      .orderBy('s.created_at', 'desc')
      .orderBy('s.id', 'desc')
      .execute();
  }

  async listRawForTrip(tripId: number | string): Promise<BudgetSettlementRow[]> {
    return this.kysely<BudgetSettlementsWriteKyselyDB>()
      .selectFrom('budget_settlements')
      .selectAll()
      .where('trip_id', '=', Number(tripId))
      .execute();
  }

  /**
   * BG77 (`getSettlement`) — `SETTLEMENT_SELECT WHERE s.trip_id = ? AND s.id
   * = ?`, the targeted single-row read. `id: number` (Plan 4 Task 8b, U6 —
   * the program's gate-level id parsing carry: `BudgetController
   * .updateSettlement`/`.deleteSettlement` parse `:settlementId` once via
   * `toRowId` and thread the number down; `trip_id` stays `number | string`,
   * a separate, still-accepted carry).
   */
  async findWithUsers(id: number, trip_id: number | string): Promise<BudgetSettlementWithUsersRow | undefined> {
    return await this.joinedQuery()
      .where('s.trip_id', '=', trip_id as number)
      .where('s.id', '=', id)
      .executeTakeFirst();
  }

  /** BG79/BG81 — `SELECT id FROM budget_settlements WHERE id = ? AND trip_id = ?`, the trip-scoping existence guard. `id: number`, same Plan 4 Task 8b narrowing as {@link findWithUsers}. */
  async findGuard(id: number, trip_id: number | string): Promise<{ id: number } | undefined> {
    return await this.kysely<BudgetSettlementsKyselyDB>()
      .selectFrom('budget_settlements')
      .select('id')
      .where('id', '=', id)
      .where('trip_id', '=', trip_id as number)
      .executeTakeFirst();
  }

  /**
   * BG78 — `INSERT INTO budget_settlements (trip_id, from_user_id,
   * to_user_id, amount, currency, exchange_rate, settled_at, note,
   * created_by_user_id) VALUES (?×9)`. Named `insertSettlement`, not
   * `insert` — collides with `TrekRepository`'s own same-named method.
   */
  async insertSettlement(
    row: {
      trip_id: number | string;
      from_user_id: number;
      to_user_id: number;
      amount: number;
      currency: string | null;
      exchange_rate: number;
      settled_at: string | null;
      note: string | null;
      created_by_user_id: number | null;
    } & Partial<BudgetRateColumns>,
  ): Promise<number> {
    const inserted = await this.kysely<BudgetSettlementsWriteKyselyDB>()
      .insertInto('budget_settlements')
      .values({ ...row, trip_id: row.trip_id as number })
      .returning('id')
      .executeTakeFirstOrThrow();
    return inserted.id;
  }

  /**
   * BG80 (`applySettlementUpdate`) — the 7-column presence-sentinel `UPDATE`
   * (`from_user_id`/`to_user_id`/`amount` unconditional, `currency`/
   * `exchange_rate`/`settled_at`/`note` presence-gated) — R11's helper, the same
   * shape `BudgetItemsRepository.update` (BG33) lands.
   */
  /** `id: number`, same Plan 4 Task 8b narrowing as {@link findWithUsers} (its one caller, `applySettlementUpdate`, is only reached with a `toRowId`-parsed id). */
  async update(
    id: number,
    write: {
      from_user_id: number;
      to_user_id: number;
      amount: number;
      currency?: [present: boolean, value: string | null];
      exchange_rate?: [present: boolean, value: number];
      settled_at?: [present: boolean, value: string | null];
      note?: [present: boolean, value: string | null];
    },
    rate?: Partial<BudgetRateColumns>,
  ): Promise<void> {
    const data = presenceSet<{
      currency: string | null;
      exchange_rate: number;
      settled_at: string | null;
      note: string | null;
    }>({
      currency: write.currency,
      exchange_rate: write.exchange_rate,
      settled_at: write.settled_at,
      note: write.note,
    });
    await this.kysely<BudgetSettlementsKyselyDB>()
      .updateTable('budget_settlements')
      .set({ from_user_id: write.from_user_id, to_user_id: write.to_user_id, amount: write.amount, ...data, ...rate })
      .where('id', '=', id)
      .execute();
  }

  /** BG82 — `DELETE FROM budget_settlements WHERE id = ?`. `id: number`, same Plan 4 Task 8b narrowing as {@link findWithUsers}. */
  async deleteById(id: number): Promise<void> {
    await this.kysely<BudgetSettlementsKyselyDB>().deleteFrom('budget_settlements').where('id', '=', id).execute();
  }

  /** How many recorded payments a user sent or received: `SELECT COUNT(*) FROM budget_settlements WHERE from_user_id = ? OR to_user_id = ?`. */
  async countForUser(user_id: number): Promise<number> {
    const row = await this.kysely<BudgetSettlementsKyselyDB>()
      .selectFrom('budget_settlements')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where((eb) => eb.or([eb('from_user_id', '=', user_id), eb('to_user_id', '=', user_id)]))
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /**
   * `UPDATE budget_settlements SET created_by_user_id = NULL WHERE
   * created_by_user_id = ?`. The column has no ON DELETE action, so deleting a
   * user who recorded a payment between two other members failed on the
   * foreign key. The payment itself belongs to those two and stays.
   */
  async clearCreatedBy(user_id: number): Promise<void> {
    await this.kysely<BudgetSettlementsKyselyDB>()
      .updateTable('budget_settlements')
      .set({ created_by_user_id: null })
      .where('created_by_user_id', '=', user_id)
      .execute();
  }

  /**
   * BG90's `budget_settlements` half (`freezeMissingRates`) — `SELECT
   * UPPER(currency) AS cur FROM budget_settlements WHERE trip_id = ? AND
   * currency IS NOT NULL AND currency != '' AND UPPER(currency) != ? AND
   * (exchange_rate IS NULL OR exchange_rate <= 0 OR exchange_rate = 1)`.
   * `DISTINCT` stands in for the dedupe the legacy UNION did.
   */
  async listUnfrozenForeignCurrencies(trip_id: number | string, trip_currency: string): Promise<string[]> {
    const rows = await this.kysely<BudgetSettlementsKyselyDB>()
      .selectFrom('budget_settlements')
      .select((eb) => eb.fn<string>('upper', ['currency']).as('cur'))
      .distinct()
      .where('trip_id', '=', trip_id as number)
      .where('currency', 'is not', null)
      .where('currency', '!=', '')
      .where((eb) => eb(eb.fn<string>('upper', ['currency']), '!=', trip_currency))
      .where((eb) =>
        eb.or([
          eb('exchange_rate', 'is', null),
          eb('exchange_rate', '<=', 0),
          eb.and([
            eb('exchange_rate', '=', 1),
            eb('exchange_rate_source', 'not in', ['identity', 'explicit', 'trip', 'global']),
          ]),
        ]),
      )
      .execute();
    return rows.map((r) => r.cur);
  }

  /** BG91's `budget_settlements` half (`freezeMissingRates`) — `SELECT id FROM budget_settlements WHERE trip_id = ? AND UPPER(currency) = ? AND (exchange_rate IS NULL OR exchange_rate <= 0 OR exchange_rate = 1)`. */
  async listUnfrozenIdsForCurrency(trip_id: number | string, currency: string): Promise<number[]> {
    const rows = await this.kysely<BudgetSettlementsKyselyDB>()
      .selectFrom('budget_settlements')
      .select('id')
      .where('trip_id', '=', trip_id as number)
      .where((eb) => eb(eb.fn<string>('upper', ['currency']), '=', currency))
      .where((eb) =>
        eb.or([
          eb('exchange_rate', 'is', null),
          eb('exchange_rate', '<=', 0),
          eb.and([
            eb('exchange_rate', '=', 1),
            eb('exchange_rate_source', 'not in', ['identity', 'explicit', 'trip', 'global']),
          ]),
        ]),
      )
      .execute();
    return rows.map((r) => r.id);
  }

  /** BG92's `budget_settlements` half (`freezeMissingRates`) — `UPDATE budget_settlements SET exchange_rate = ? WHERE trip_id = ? AND UPPER(currency) = ? AND (exchange_rate IS NULL OR exchange_rate <= 0 OR exchange_rate = 1)`, the compare-and-set write. */
  async freezeUnfrozenForCurrency(trip_id: number | string, currency: string, rate: BudgetRateColumns): Promise<void> {
    await this.kysely<BudgetSettlementsKyselyDB>()
      .updateTable('budget_settlements')
      .set(rate)
      .where('trip_id', '=', trip_id as number)
      .where((eb) => eb(eb.fn<string>('upper', ['currency']), '=', currency))
      .where((eb) =>
        eb.or([
          eb('exchange_rate', 'is', null),
          eb('exchange_rate', '<=', 0),
          eb.and([
            eb('exchange_rate', '=', 1),
            eb('exchange_rate_source', 'not in', ['identity', 'explicit', 'trip', 'global']),
          ]),
        ]),
      )
      .execute();
  }

  async setRebasedRate(id: number, currency: string, rate: Partial<BudgetRateColumns>): Promise<void> {
    await this.kysely<BudgetSettlementsWriteKyselyDB>()
      .updateTable('budget_settlements')
      .set({ currency, ...rate })
      .where('id', '=', id)
      .execute();
  }
}
