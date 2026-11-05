import { EntityRepositoryType, PrimaryKeyProp, defineEntity, p } from '@mikro-orm/core';
import { GlobalExchangeRateSnapshotsRepository } from '../repositories/GlobalExchangeRateSnapshots.repository';

export class GlobalExchangeRateSnapshots {
  [EntityRepositoryType]?: GlobalExchangeRateSnapshotsRepository;
  [PrimaryKeyProp]?: 'base_currency';
  base_currency?: string | null;
  rates_json!: string;
  source_version!: string;
  effective_date?: string | null;
  fetched_at!: string;
}

export const GlobalExchangeRateSnapshotsSchema = defineEntity({
  class: GlobalExchangeRateSnapshots,
  repository: () => GlobalExchangeRateSnapshotsRepository,
  properties: {
    base_currency: p.text().primary().nullable(),
    rates_json: p.text(),
    source_version: p.text(),
    effective_date: p.text().nullable(),
    fetched_at: p.text(),
  },
});
