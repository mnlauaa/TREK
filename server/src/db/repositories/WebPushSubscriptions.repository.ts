import { currentTimestampKysely } from '../dialect/kysely-functions';
import type { WebPushSubscriptions } from '../entities/WebPushSubscriptions.entity';
import type { DB } from '../kysely/db';
import { TrekRepository } from './_shared/trek-repository';

import type { Insertable, Selectable } from 'kysely';

type DeviceTable = DB['web_push_subscriptions'];
export type WebPushDeviceRow = Selectable<DeviceTable>;
export type WebPushDeviceRegistration = Pick<
  Insertable<DeviceTable>,
  | 'user_id'
  | 'installation_id'
  | 'endpoint_hash'
  | 'subscription_encrypted'
  | 'origin'
  | 'vapid_key_fingerprint'
  | 'label'
>;

export interface WebPushDeviceScope {
  userId: number;
  origin: string;
  fingerprint: string;
}

export class WebPushSubscriptionsRepository extends TrekRepository<WebPushSubscriptions> {
  private db() {
    return this.kysely<Pick<DB, 'web_push_subscriptions'>>();
  }

  private now() {
    return currentTimestampKysely(this.getEntityManager().getPlatform());
  }

  private eligible({ userId, origin, fingerprint }: WebPushDeviceScope) {
    return this.db()
      .selectFrom('web_push_subscriptions')
      .where('user_id', '=', userId)
      .where('origin', '=', origin)
      .where('vapid_key_fingerprint', '=', fingerprint)
      .where('status', '=', 'active');
  }

  async listEligible(scope: WebPushDeviceScope): Promise<WebPushDeviceRow[]> {
    return this.eligible(scope).selectAll().orderBy('updated_at', 'desc').orderBy('id', 'desc').execute();
  }

  async hasEligible(scope: WebPushDeviceScope): Promise<boolean> {
    return !!(await this.eligible(scope).select('id').limit(1).executeTakeFirst());
  }

  async countEligible(scope: WebPushDeviceScope): Promise<number> {
    const { count } = await this.eligible(scope)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  async markOriginMismatches(userId: number, origin: string): Promise<void> {
    await this.db()
      .updateTable('web_push_subscriptions')
      .set({ status: 'origin_mismatch', updated_at: this.now() })
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .where('origin', '!=', origin)
      .execute();
  }

  async findInstallation(userId: number, installationId: string): Promise<WebPushDeviceRow | undefined> {
    return this.db()
      .selectFrom('web_push_subscriptions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('installation_id', '=', installationId)
      .executeTakeFirst();
  }

  async revokeEndpointConflict(hash: string, userId: number, installationId: string): Promise<void> {
    const conflict = await this.db()
      .selectFrom('web_push_subscriptions')
      .select('id')
      .where('endpoint_hash', '=', hash)
      .where((eb) => eb.or([eb('user_id', '!=', userId), eb('installation_id', '!=', installationId)]))
      .executeTakeFirst();
    if (!conflict) return;
    const now = this.now();
    await this.db()
      .updateTable('web_push_subscriptions')
      .set({ endpoint_hash: `revoked:${conflict.id}:${hash}`, status: 'revoked', revoked_at: now, updated_at: now })
      .where('id', '=', conflict.id)
      .where('endpoint_hash', '=', hash)
      .execute();
  }

  async upsertDevice(row: WebPushDeviceRegistration): Promise<WebPushDeviceRow> {
    const now = this.now();
    return this.db()
      .insertInto('web_push_subscriptions')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['user_id', 'installation_id']).doUpdateSet({
          ...row,
          status: 'active',
          revoked_at: null,
          last_error_at: null,
          last_seen_at: now,
          updated_at: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async renameDevice(userId: number, id: number, label: string): Promise<WebPushDeviceRow | undefined> {
    return this.db()
      .updateTable('web_push_subscriptions')
      .set({ label, updated_at: this.now() })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .returningAll()
      .executeTakeFirst();
  }

  async revokeDevice(userId: number, id: number): Promise<boolean> {
    const now = this.now();
    const row = await this.db()
      .updateTable('web_push_subscriptions')
      .set({ status: 'revoked', revoked_at: now, updated_at: now })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .returning('id')
      .executeTakeFirst();
    return !!row;
  }

  async recordDelivery(
    row: Pick<WebPushDeviceRow, 'id' | 'subscription_encrypted'>,
    outcome: 'sent' | 'invalid' | 'failed',
  ): Promise<void> {
    const now = this.now();
    const changes =
      outcome === 'sent'
        ? { last_success_at: now, last_error_at: null }
        : { last_error_at: now, ...(outcome === 'invalid' ? { status: 'invalid' } : {}) };
    await this.db()
      .updateTable('web_push_subscriptions')
      .set({ ...changes, updated_at: now })
      .where('id', '=', row.id)
      .where('status', '=', 'active')
      .where('subscription_encrypted', '=', row.subscription_encrypted)
      .execute();
  }
}
