import { EntityRepositoryType, type Opt, PrimaryKeyProp, type Ref, defineEntity, p } from '@mikro-orm/core';
import { TripExchangeRatesRepository } from '../repositories/TripExchangeRates.repository';
import { Trips } from './Trips.entity';
import { Users } from './Users.entity';

export class TripExchangeRates {
  [EntityRepositoryType]?: TripExchangeRatesRepository;
  [PrimaryKeyProp]?: ['trip', 'currency'];
  trip!: Ref<Trips>;
  trip_id!: number;
  currency!: string;
  exchange_rate!: number;
  effective_date?: string | null;
  source_version!: string;
  set_at!: string & Opt;
  setByUser?: Ref<Users> | null;
  set_by_user_id?: number | null;
  note?: string | null;
}

export const TripExchangeRatesSchema = defineEntity({
  class: TripExchangeRates,
  repository: () => TripExchangeRatesRepository,
  uniques: [{ properties: ['trip', 'currency'] }],
  properties: {
    trip: () => p.manyToOne(Trips).primary().ref().deleteRule('cascade').hidden(),
    trip_id: p.integer().persist(false),
    currency: p.text().primary(),
    exchange_rate: p.double(),
    effective_date: p.text().nullable(),
    source_version: p.text(),
    set_at: p.text().defaultRaw(`(datetime('now'))`),
    setByUser: () => p.manyToOne(Users).ref().nullable().hidden().index('idx_trip_exchange_rates_set_by'),
    set_by_user_id: p.integer().nullable().persist(false).index('idx_trip_exchange_rates_set_by'),
    note: p.text().nullable(),
  },
});
