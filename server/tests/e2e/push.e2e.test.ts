/**
 * Web Push routes e2e: /api/notifications/web-push/* and the push test send
 * through the real JwtAuthGuard, the Zod pipe and the real providers on a temp
 * SQLite db. Only the outbound POST (safeFetchFollow) is replaced.
 */
import { db } from '../../src/db/database';
import { PushSubscriptions } from '../../src/db/entities/PushSubscriptions.entity';
import { WebPushSubscriptions } from '../../src/db/entities/WebPushSubscriptions.entity';
import { decrypt_api_key } from '../../src/nest/common/crypto/apiKeyCrypto';
import { TrekExceptionFilter } from '../../src/nest/common/trek-exception.filter';
import { ZodValidationPipe } from '../../src/nest/common/zod-validation.pipe';
import { NotificationsModule } from '../../src/nest/notifications/notifications.module';
import { RealtimeModule } from '../../src/nest/realtime/realtime.module';
import { deleteRows, findRows, insertRow } from '../helpers/factories/rows';
import { readAppSetting, setAppSetting } from '../helpers/factories/settings';
import { makeUser } from '../helpers/factories/users';
import { createTestMikroOrmModule, createTestOrm, type TestOrm } from '../helpers/test-orm';
import { TestUnitOfWorkModule } from '../helpers/test-uow';
import { sessionCookie } from './harness';
import { Test } from '@nestjs/testing';
import { WEB_PUSH_CHANNEL_ID } from '@trek/shared';

import cookieParser from 'cookie-parser';
import type { Server } from 'http';
import { createECDH } from 'node:crypto';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// The migrated snapshot (users for the guard, app_settings and the
// push_subscriptions table from legacy step 245), opened inside the factory;
// the test reaches it through the mocked module.
vi.mock('../../src/db/database', async () => {
  const { createSnapshotTestDb } = await import('../helpers/db-mock');
  const db = createSnapshotTestDb();
  return { db, closeDb: () => {}, reinitialize: () => {} };
});

const { safeFetchFollow } = vi.hoisted(() => ({ safeFetchFollow: vi.fn() }));
vi.mock('../../src/utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/ssrfGuard')>()),
  safeFetchFollow,
}));

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-device';

function subscription(endpoint = ENDPOINT) {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  return {
    endpoint,
    expirationTime: null,
    keys: { p256dh: ua.getPublicKey('base64url'), auth: Buffer.alloc(16, 3).toString('base64url') },
  };
}

let orm: TestOrm;

const BASE = '/api/notifications/web-push';
const INSTALLATION = '92e5fb2d-bb3d-4cc3-8681-9ef88b2d74e7';
const current = (data = subscription(), intent: 'enable' | 'reconcile' = 'enable') => ({
  installationId: INSTALLATION,
  label: 'Mac',
  subscription: data,
  intent,
});

describe('Web Push e2e (real auth guard + temp SQLite)', () => {
  let server: Server;
  let app: Awaited<ReturnType<typeof build>>;

  async function build() {
    const moduleRef = await Test.createTestingModule({
      imports: [
        await TestUnitOfWorkModule.forRoot(db),
        await createTestMikroOrmModule(db),
        RealtimeModule,
        NotificationsModule,
      ],
    }).compile();
    const nest = moduleRef.createNestApplication();
    nest.use(cookieParser());
    nest.useGlobalPipes(new ZodValidationPipe());
    nest.useGlobalFilters(new TrekExceptionFilter());
    await nest.init();
    return nest;
  }

  beforeAll(async () => {
    vi.stubEnv('APP_URL', 'https://trek.example.test/path');
    // The two users the session cookies are signed for, pinned to ids 1 and 2.
    orm = await createTestOrm(db);
    await makeUser(orm, {
      id: 1,
      username: 'e2e-user-1',
      email: 'one@example.test',
      role: 'user',
      password_version: 0,
    });
    await makeUser(orm, {
      id: 2,
      username: 'e2e-user-2',
      email: 'two@example.test',
      role: 'user',
      password_version: 0,
    });
    app = await build();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await deleteRows(orm, PushSubscriptions);
    await deleteRows(orm, WebPushSubscriptions);
    await setAppSetting(orm, 'notification_channels', WEB_PUSH_CHANNEL_ID);
    safeFetchFollow.mockReset();
  });

  afterAll(async () => {
    await app.close();
    await orm.close();
    vi.unstubAllEnvs();
  });

  it('requires a session for device and configuration routes', async () => {
    expect((await request(server).get(`${BASE}/config`)).status).toBe(401);
    expect((await request(server).put(`${BASE}/current`).send(current())).status).toBe(401);
    expect((await request(server).delete(`${BASE}/devices/1`)).status).toBe(401);
  });

  it('exposes the existing key and encrypts the registered subscription', async () => {
    const publicKey = await readAppSetting(orm, 'web_push_vapid_public_key');
    const config = await request(server).get(`${BASE}/config`).set('Cookie', sessionCookie(1));
    expect(config.status).toBe(200);
    expect(config.body).toEqual({
      enabled: true,
      available: true,
      publicKey,
      canonicalOrigin: 'https://trek.example.test',
      maxDevices: 10,
    });
    const data = current();
    const registered = await request(server).put(`${BASE}/current`).set('Cookie', sessionCookie(1)).send(data);
    expect(registered.status).toBe(200);
    expect(registered.body).toMatchObject({ state: 'active', device: { installationId: INSTALLATION, label: 'Mac' } });
    const [row] = await findRows(orm, WebPushSubscriptions);
    expect(row.subscription_encrypted).toMatch(/^enc:v1:/);
    expect(row.endpoint_hash).not.toContain(ENDPOINT);
    expect(JSON.parse(decrypt_api_key(row.subscription_encrypted) ?? '')).toEqual(data.subscription);
    expect(await findRows(orm, PushSubscriptions)).toEqual([]);
  });

  it('moves a shared endpoint to its latest account and never reconciles the revoked installation', async () => {
    const data = current();
    await request(server).put(`${BASE}/current`).set('Cookie', sessionCookie(1)).send(data).expect(200);
    await request(server).put(`${BASE}/current`).set('Cookie', sessionCookie(2)).send(data).expect(200);
    await request(server)
      .put(`${BASE}/current`)
      .set('Cookie', sessionCookie(1))
      .send({ ...data, intent: 'reconcile' })
      .expect(200, { state: 'revoked' });
    await request(server).get(`${BASE}/devices`).set('Cookie', sessionCookie(1)).expect(200, { devices: [] });
    const list = await request(server).get(`${BASE}/devices`).set('Cookie', sessionCookie(2)).expect(200);
    expect(list.body.devices).toHaveLength(1);
  });

  it('keeps a renamed device label on reconciliation and only lets its owner revoke it', async () => {
    const data = current();
    const result = await request(server).put(`${BASE}/current`).set('Cookie', sessionCookie(1)).send(data).expect(200);
    const id = result.body.device.id;
    await request(server)
      .patch(`${BASE}/devices/${id}`)
      .set('Cookie', sessionCookie(1))
      .send({ label: 'Travel laptop' })
      .expect(200);
    const reconciled = await request(server)
      .put(`${BASE}/current`)
      .set('Cookie', sessionCookie(1))
      .send({ ...data, intent: 'reconcile' })
      .expect(200);
    expect(reconciled.body.device.label).toBe('Travel laptop');
    await request(server).delete(`${BASE}/devices/${id}`).set('Cookie', sessionCookie(2)).expect(404);
    await request(server)
      .delete(`${BASE}/devices/${id}`)
      .set('Cookie', sessionCookie(1))
      .expect(200, { success: true });
  });

  it('rejects insecure endpoints and malformed requests', async () => {
    await request(server)
      .put(`${BASE}/current`)
      .set('Cookie', sessionCookie(1))
      .send(current(subscription('http://push.example.test')))
      .expect(400);
    await request(server)
      .put(`${BASE}/current`)
      .set('Cookie', sessionCookie(1))
      .send({ ...current(), subscription: { endpoint: ENDPOINT } })
      .expect(400);
    expect(await findRows(orm, WebPushSubscriptions)).toEqual([]);
  });

  it('only sends to registered encrypted devices and retains old plaintext rows for re-registration', async () => {
    const data = current();
    await insertRow(orm, PushSubscriptions, {
      user: 1,
      endpoint: ENDPOINT,
      p256dh: data.subscription.keys.p256dh,
      auth: data.subscription.keys.auth,
      vapid_public_key: (await readAppSetting(orm, 'web_push_vapid_public_key'))!,
    });
    await request(server).get(`${BASE}/devices`).set('Cookie', sessionCookie(1)).expect(200, { devices: [] });
    expect(safeFetchFollow).not.toHaveBeenCalled();
    const registered = await request(server)
      .put(`${BASE}/current`)
      .set('Cookie', sessionCookie(1))
      .send(data)
      .expect(200);
    const id = registered.body.device.id;
    safeFetchFollow.mockResolvedValue(new Response(null, { status: 201 }));
    await request(server)
      .post(`${BASE}/devices/${id}/test`)
      .set('Cookie', sessionCookie(1))
      .expect(200, { success: true });
    expect(safeFetchFollow).toHaveBeenCalledExactlyOnceWith(
      ENDPOINT,
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
      { maxRedirects: 0, bypassInternalIpAllowed: true },
    );
    expect(await findRows(orm, PushSubscriptions)).toHaveLength(1);
  });

  it('reports an unreadable VAPID key as unavailable and leaves its stored identity intact', async () => {
    const privateKey = await readAppSetting(orm, 'web_push_vapid_private_key');
    try {
      await setAppSetting(orm, 'web_push_vapid_private_key', 'enc:v1:unreadable');
      const config = await request(server).get(`${BASE}/config`).set('Cookie', sessionCookie(1)).expect(200);
      expect(config.body).toMatchObject({ enabled: true, available: false, error: expect.any(String) });
      await request(server).put(`${BASE}/current`).set('Cookie', sessionCookie(1)).send(current()).expect(503);
      expect(await readAppSetting(orm, 'web_push_vapid_private_key')).toBe('enc:v1:unreadable');
    } finally {
      await setAppSetting(orm, 'web_push_vapid_private_key', privateKey!);
    }
  });
});
