import { EntityRepositoryType, type Opt, defineEntity, p } from '@mikro-orm/core';
import { ForkSchemaMigrationsRepository } from '../repositories/ForkSchemaMigrations.repository';

export class ForkSchemaMigrations {
  [EntityRepositoryType]?: ForkSchemaMigrationsRepository;
  id?: string | null;
  applied_at!: string & Opt;
}

export const ForkSchemaMigrationsSchema = defineEntity({
  class: ForkSchemaMigrations,
  repository: () => ForkSchemaMigrationsRepository,
  properties: {
    id: p.text().primary().nullable(),
    applied_at: p.text().defaultRaw(`CURRENT_TIMESTAMP`),
  },
});
