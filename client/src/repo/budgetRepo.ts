import { budgetApi } from '../api/client'
import { offlineDb, upsertBudgetItems } from '../db/offlineDb'
import { onlineThenCache } from './withOfflineFallback'
import type { BudgetItem } from '../types'

export const budgetRepo = {
  async list(tripId: number | string, isCurrent: () => boolean = () => true): Promise<{ items: BudgetItem[] }> {
    return onlineThenCache(
      async () => {
        const result = await budgetApi.list(tripId)
        await offlineDb.transaction('rw', offlineDb.budgetItems, async () => {
          if (isCurrent()) await upsertBudgetItems(result.items)
        }).catch(error => console.warn('Failed to cache budget items:', error))
        return result
      },
      async () => ({
        items: await offlineDb.budgetItems
          .where('trip_id').equals(Number(tripId)).toArray(),
      }),
    )
  },
}
