import { PushSubscriptions } from '../../../../src/db/entities/PushSubscriptions.entity';
import { WebPushSubscriptions } from '../../../../src/db/entities/WebPushSubscriptions.entity';
import type { PushSubscriptionsRepository } from '../../../../src/db/repositories/PushSubscriptions.repository';
import { createSnapshotTestDb } from '../../../helpers/db-mock';
import { createUser } from '../../../helpers/factories';
import { findRow, findRows, insertRow, updateRows } from '../../../helpers/factories/rows';
import { resetTestDb } from '../../../helpers/test-db';
import { createTestOrm, type TestOrm } from '../../../helpers/test-orm';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = createSnapshotTestDb();
let t: TestOrm;
let subscriptions: PushSubscriptionsRepository;
beforeAll(async () => {
  t = await createTestOrm(db);
  subscriptions = t.repo(PushSubscriptions);
});
beforeEach(() => {
  resetTestDb(db);
  t.clear();
});
afterAll(async () => {
  await t.close();
  db.close();
});

const registration = (user_id: number, endpoint: string) => ({
  user_id,
  endpoint,
  p256dh: 'public-key',
  auth: 'auth-key',
  vapid_public_key: 'vapid-key',
  user_agent: null,
});
const seed = (user: number, endpoint: string, created_at = '2026-01-01 00:00:00') =>
  insertRow(t, PushSubscriptions, {
    user,
    endpoint,
    p256dh: 'public-key',
    auth: 'auth-key',
    vapid_public_key: 'vapid-key',
    created_at,
  });

describe('PushSubscriptionsRepository', () => {
  it('registers defaults and reassigns an endpoint with refreshed credentials and reset failures', async () => {
    const { user: first } = createUser(db);
    const { user: next } = createUser(db);
    await subscriptions.upsertSubscription(registration(first.id, 'https://push.example/device'));
    const before = await findRow(t, PushSubscriptions, { endpoint: 'https://push.example/device' });
    expect(before).toMatchObject({
      user_id: first.id,
      failure_count: 0,
      last_success_at: null,
      user_agent: null,
      created_at: expect.any(String),
    });
    await updateRows(
      t,
      PushSubscriptions,
      { endpoint: 'https://push.example/device' },
      { created_at: '2000-01-01 00:00:00', failure_count: 3 },
    );
    const replacement = {
      ...registration(next.id, 'https://push.example/device'),
      p256dh: 'next-public',
      auth: 'next-auth',
      vapid_public_key: 'next-vapid',
      user_agent: 'Browser',
    };
    await subscriptions.upsertSubscription(replacement);
    const rows = await findRows(t, PushSubscriptions, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...replacement, id: before?.id, failure_count: 0 });
    expect(rows[0].created_at).not.toBe('2000-01-01 00:00:00');
    expect(await subscriptions.hasAnyForUser(first.id)).toBe(false);
    expect(await subscriptions.hasAnyForUser(next.id)).toBe(true);
    expect(await subscriptions.countForUser(next.id)).toBe(1);
  });

  it('evicts only the oldest owned devices, preserves the active endpoint, and breaks timestamp ties by id', async () => {
    const { user } = createUser(db);
    const { user: other } = createUser(db);
    const keep = await seed(user.id, 'keep', '1999-01-01 00:00:00');
    const oldest = await seed(user.id, 'oldest');
    const tied = await seed(user.id, 'tied');
    const newer = await seed(user.id, 'newer', '2026-02-01 00:00:00');
    const foreign = await seed(other.id, 'foreign', '1990-01-01 00:00:00');
    await subscriptions.deleteOldestForUser(user.id, 'keep', 1);
    expect(await findRow(t, PushSubscriptions, { id: oldest })).toBeNull();
    expect((await subscriptions.listForUser(user.id)).map((row) => row.id)).toEqual([keep, tied, newer]);
    expect(await findRow(t, PushSubscriptions, { id: foreign })).not.toBeNull();
    await subscriptions.deleteOldestForUser(user.id, 'keep', 0);
    expect(await subscriptions.countForUser(user.id)).toBe(3);
    expect(await subscriptions.listForUser(-1)).toEqual([]);
  });

  it('counts concurrent delivery failures atomically and resets them on success without affecting another device', async () => {
    const { user } = createUser(db);
    const id = await seed(user.id, 'device');
    const other = await seed(user.id, 'other');
    expect(
      (await Promise.all([subscriptions.incrementFailureCount(id), subscriptions.incrementFailureCount(id)])).sort(),
    ).toEqual([1, 2]);
    expect(await findRow(t, PushSubscriptions, { id })).toMatchObject({ failure_count: 2, last_success_at: null });
    await subscriptions.recordSuccess(id);
    expect(await findRow(t, PushSubscriptions, { id })).toMatchObject({
      failure_count: 0,
      last_success_at: expect.any(String),
    });
    expect(await findRow(t, PushSubscriptions, { id: other })).toMatchObject({
      failure_count: 0,
      last_success_at: null,
    });
    await subscriptions.deleteSubscription(id);
    expect(await subscriptions.incrementFailureCount(id)).toBe(0);
    expect(await findRow(t, PushSubscriptions, { id })).toBeNull();
  });

  it('scopes endpoint removal and credential revocation to the user across legacy and encrypted registrations', async () => {
    const { user } = createUser(db);
    const { user: other } = createUser(db);
    const id = await seed(user.id, 'device');
    const foreign = await seed(other.id, 'other');
    const encrypted = await insertRow(t, WebPushSubscriptions, {
      user: user.id,
      installation_id: 'one',
      endpoint_hash: 'hash-one',
      subscription_encrypted: 'cipher',
      origin: 'https://trek.example',
      vapid_key_fingerprint: 'fingerprint',
      label: 'Phone',
    });
    const encryptedOther = await insertRow(t, WebPushSubscriptions, {
      user: other.id,
      installation_id: 'two',
      endpoint_hash: 'hash-two',
      subscription_encrypted: 'cipher-two',
      origin: 'https://trek.example',
      vapid_key_fingerprint: 'fingerprint',
      label: 'Tablet',
    });
    expect(await subscriptions.deleteForUserEndpoint(other.id, 'device')).toBe(false);
    expect(await subscriptions.deleteForUserEndpoint(user.id, 'device')).toBe(true);
    expect(await subscriptions.deleteForUserEndpoint(user.id, 'device')).toBe(false);
    expect(await findRow(t, PushSubscriptions, { id })).toBeNull();
    await seed(user.id, 'replacement');
    await subscriptions.deleteAllForUser(user.id);
    expect(await subscriptions.countForUser(user.id)).toBe(0);
    expect(await findRow(t, WebPushSubscriptions, { id: encrypted })).toBeNull();
    expect(await findRow(t, WebPushSubscriptions, { id: encryptedOther })).not.toBeNull();
    expect(await findRow(t, PushSubscriptions, { id: foreign })).not.toBeNull();
  });
});
