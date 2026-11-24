import { EntityRepositoryType, type Opt, type Ref, defineEntity, p } from '@mikro-orm/core';
import { ExchangeRateBatchPreviewsRepository } from '../repositories/ExchangeRateBatchPreviews.repository';
import { Trips } from './Trips.entity';
import { Users } from './Users.entity';

export class ExchangeRateBatchPreviews {
  [EntityRepositoryType]?: ExchangeRateBatchPreviewsRepository;
  id?: string | null;
  trip!: Ref<Trips>;
  trip_id!: number;
  currency!: string;
  exchange_rate!: number;
  note?: string | null;
  state_token!: string;
  preview_json!: string;
  createdByUser?: Ref<Users> | null;
  created_by_user_id?: number | null;
  created_at!: string & Opt;
}

export const ExchangeRateBatchPreviewsSchema = defineEntity({
  class: ExchangeRateBatchPreviews,
  repository: () => ExchangeRateBatchPreviewsRepository,
  properties: {
    id: p.text().primary().nullable(),
    trip: () => p.manyToOne(Trips).ref().deleteRule('cascade').hidden().index('idx_exchange_rate_batch_previews_trip'),
    trip_id: p.integer().persist(false).index('idx_exchange_rate_batch_previews_trip'),
    currency: p.text(),
    exchange_rate: p.double(),
    note: p.text().nullable(),
    state_token: p.text(),
    preview_json: p.text(),
    createdByUser: () => p.manyToOne(Users).ref().deleteRule('cascade').nullable().hidden().index('idx_exchange_rate_batch_previews_created_by'),
    created_by_user_id: p.integer().nullable().persist(false).index('idx_exchange_rate_batch_previews_created_by'),
    created_at: p.text().defaultRaw(`CURRENT_TIMESTAMP`).index('idx_exchange_rate_batch_previews_created_at'),
  },
});
