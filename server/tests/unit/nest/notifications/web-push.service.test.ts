import { db as testDb } from '../../../../src/db/database';
import { WebPushSubscriptions } from '../../../../src/db/entities/WebPushSubscriptions.entity';
import { ALL_EVENT_TYPES, type ChannelMessage } from '../../../../src/nest/notifications/notification-events';
import { generateVapidKeyPair } from '../../../../src/nest/notifications/push/web-push-crypto';
import {
  BACKGROUND_PUSH_HEADER,
  MAX_PUSH_PAYLOAD_BYTES,
  MAX_WEB_PUSH_DEVICES,
  WebPushService,
  buildPushPayload,
  isAppleRelayEndpoint,
  samePagePath,
} from '../../../../src/nest/notifications/transports/web-push.service';
import { createUser, setNotificationChannels } from '../../../helpers/factories';
import { findRows, updateRows } from '../../../helpers/factories/rows';
import { makeNotificationsService, makeWebPushService } from '../../../helpers/notifications';
import { resetTestDb } from '../../../helpers/test-db';
import { sharedTestOrm } from '../../../helpers/test-uow';
import { WEB_PUSH_CHANNEL_ID } from '@trek/shared';

import { createDecipheriv, createECDH, hkdfSync, randomUUID, type ECDH } from 'node:crypto';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';

vi.mock('../../../../src/db/database', async () => {
  const { createSnapshotTestDb } = await import('../../../helpers/db-mock');
  const db = createSnapshotTestDb();
  return { db, closeDb: () => {}, reinitialize: () => {} };
});
const { safeFetchFollow } = vi.hoisted(() => ({ safeFetchFollow: vi.fn() }));
vi.mock('../../../../src/utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/utils/ssrfGuard')>()),
  safeFetchFollow,
}));

const ENDPOINT = 'https://push.example.test:8443/push/device';
let push: WebPushService;

beforeAll(async () => {
  await makeNotificationsService(testDb);
  push = await makeWebPushService(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  vi.stubEnv('APP_URL', 'https://trek.example.test');
  setNotificationChannels(testDb, WEB_PUSH_CHANNEL_ID);
  safeFetchFollow.mockReset();
});

afterEach(() => vi.unstubAllEnvs());
afterAll(() => testDb.close());

async function rows(userId: number) {
  return findRows(await sharedTestOrm(testDb), WebPushSubscriptions, { user: userId }, { id: 'asc' });
}

const MSG: ChannelMessage = {
  event: 'collab_message',
  title: 'New message in "Lisbon"',
  body: 'alice: see you at the station',
  navigateTarget: '/trips/12',
  url: 'https://trek.example.test/trips/12',
};

interface Device {
  endpoint: string;
  ua: ECDH;
  auth: Buffer;
}

function deviceInput(
  endpoint: string,
  installationId: string = randomUUID(),
  intent: 'enable' | 'reconcile' = 'enable',
) {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = Buffer.from('fedcba9876543210');
  return {
    device: { endpoint, ua, auth },
    input: {
      installationId,
      intent,
      label: 'Browser',
      subscription: {
        endpoint,
        keys: { p256dh: ua.getPublicKey('base64url'), auth: auth.toString('base64url') },
      },
    },
  };
}

async function subscribe(userId: number, endpoint = ENDPOINT) {
  const { device, input } = deviceInput(endpoint);
  const result = await push.registerCurrent(userId, input);
  return { ...device, id: result.device!.id, input };
}

/** The browser's side of RFC 8291, to read what was actually sent. */
function open(body: Uint8Array, device: Device): unknown {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const keyId = buf.subarray(21, 21 + buf[20]);
  const record = buf.subarray(21 + buf[20]);
  const secret = device.ua.computeSecret(keyId);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), device.ua.getPublicKey(), keyId]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, device.auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  return JSON.parse(padded.subarray(0, padded.lastIndexOf(0x02)).toString('utf8'));
}

function reply(status: number, text = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    headers: { get: () => null },
    text: async () => text,
  };
}

describe('Encrypted Web Push delivery', () => {
  it('sends one VAPID-signed message with a bounded, recipient-aware worker payload', async () => {
    const { user } = createUser(testDb);
    const device = await subscribe(user.id);
    safeFetchFollow.mockResolvedValue(reply(201));

    await expect(push.sendToUser(user.id, { ...MSG, body: '🚄'.repeat(5000) })).resolves.toEqual({
      sent: 1,
      invalid: 0,
      failed: 0,
    });
    expect(safeFetchFollow).toHaveBeenCalledTimes(1);
    const [url, init, options] = safeFetchFollow.mock.calls[0];
    expect(url).toBe(device.endpoint);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Encoding': 'aes128gcm', Authorization: expect.stringMatching(/^vapid t=/) },
      signal: expect.any(AbortSignal),
    });
    expect(options).toEqual({ maxRedirects: 0, bypassInternalIpAllowed: true });
    const payload = open(init.body, device);
    expect(payload).toMatchObject({
      v: 1,
      recipientUserId: user.id,
      title: MSG.title,
      path: '/trips/12',
      unreadCount: 0,
      event: MSG.event,
    });
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect((await rows(user.id))[0]).toMatchObject({ last_success_at: expect.any(String), last_error_at: null });
  });

  it.each([404, 410])('marks an expired device invalid after HTTP %i', async (status) => {
    const { user } = createUser(testDb);
    await subscribe(user.id);
    safeFetchFollow.mockResolvedValue(reply(status));
    await expect(push.sendToUser(user.id, MSG)).resolves.toEqual({ sent: 0, invalid: 1, failed: 0 });
    expect((await rows(user.id))[0]).toMatchObject({ status: 'invalid', last_error_at: expect.any(String) });
  });

  it('rejects corrupt ciphertext before sending and records other errors without revoking', async () => {
    const { user } = createUser(testDb);
    const corrupt = await subscribe(user.id, ENDPOINT + '/corrupt');
    await subscribe(user.id, ENDPOINT + '/transient');
    await updateRows(
      await sharedTestOrm(testDb),
      WebPushSubscriptions,
      { id: corrupt.id },
      {
        subscription_encrypted: 'enc:v1:unreadable',
      },
    );
    safeFetchFollow.mockRejectedValue(new Error('timed out'));
    await expect(push.sendToUser(user.id, MSG)).resolves.toEqual({ sent: 0, invalid: 1, failed: 1 });
    expect(safeFetchFollow).toHaveBeenCalledTimes(1);
    expect(await rows(user.id)).toMatchObject([
      { status: 'invalid', last_error_at: expect.any(String) },
      { status: 'active', last_error_at: expect.any(String) },
    ]);
  });

  it('fails closed on origin changes and ignores stale delivery responses after reconciliation', async () => {
    const { user } = createUser(testDb);
    const { input, id } = await subscribe(user.id);
    safeFetchFollow.mockImplementation(async () => {
      await push.registerCurrent(user.id, { ...input, intent: 'reconcile' });
      return reply(410);
    });
    await push.sendToUser(user.id, MSG);
    expect((await rows(user.id))[0]).toMatchObject({ id, status: 'active' });

    vi.stubEnv('APP_URL', 'https://new.example.test');
    expect(await push.listDevices(user.id)).toEqual([]);
    await expect(push.registerCurrent(user.id, { ...input, intent: 'reconcile' })).resolves.toEqual({
      state: 'revoked',
    });
    expect((await rows(user.id))[0]).toMatchObject({ id, status: 'origin_mismatch' });
  });

  it('applies the cap to new and reactivated devices and makes a key change require reconciliation', async () => {
    const { user } = createUser(testDb);
    const revoked = await subscribe(user.id);
    await push.revokeDevice(user.id, revoked.id);
    for (let i = 0; i < MAX_WEB_PUSH_DEVICES; i++) await subscribe(user.id, ENDPOINT + '/' + i);
    await expect(push.registerCurrent(user.id, revoked.input)).rejects.toMatchObject({ code: 'WEB_PUSH_DEVICE_LIMIT' });

    const pair = generateVapidKeyPair();
    vi.stubEnv('WEB_PUSH_VAPID_PUBLIC_KEY', pair.publicKey);
    vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', pair.privateKey);
    expect(await push.listDevices(user.id)).toEqual([]);
    expect(await push.config()).toMatchObject({ available: true, publicKey: pair.publicKey });
    const previous = (await rows(user.id))[1];
    const refreshed = deviceInput(ENDPOINT + '/fresh', previous.installation_id, 'reconcile');
    await expect(push.registerCurrent(user.id, refreshed.input)).resolves.toMatchObject({ state: 'active' });
    expect(await push.listDevices(user.id)).toHaveLength(1);
  });
});

describe('WebPushService.sendWatchSync', () => {
  const APNS = `https://push.liketrek.com/v1/apns/production/${'ab'.repeat(32)}`;
  const FCM = `https://push.liketrek.com/v1/fcm/${'x'.repeat(140)}`;
  const BROWSER = 'https://fcm.googleapis.com/fcm/send/watch-sync-browser';

  it('WSYNC-008: only the iPhone app gets it, as a short-lived background push the relay recognises', async () => {
    const { user } = createUser(testDb);
    const device = await subscribe(user.id, APNS);
    await subscribe(user.id, FCM);
    await subscribe(user.id, BROWSER);
    safeFetchFollow.mockResolvedValue(reply(201));

    expect(await push.sendWatchSync(user.id)).toBe(true);
    expect(safeFetchFollow).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetchFollow.mock.calls[0];
    expect(url).toBe(APNS);
    expect(open(init.body, device)).toEqual({ type: 'watch-sync' });
    expect(init.headers).toMatchObject({
      [BACKGROUND_PUSH_HEADER]: 'background',
      Topic: 'trek-watch-sync',
      Urgency: 'low',
      TTL: '600',
      'Content-Encoding': 'aes128gcm',
    });
  });

  it('WSYNC-009: a user without the iPhone app sends nothing', async () => {
    const { user } = createUser(testDb);
    await subscribe(user.id, BROWSER);
    expect(await push.sendWatchSync(user.id)).toBe(false);
    expect(safeFetchFollow).not.toHaveBeenCalled();
  });

  it('WSYNC-010: an ordinary notification to the same app goes out without the background mark', async () => {
    const { user } = createUser(testDb);
    await subscribe(user.id, APNS);
    safeFetchFollow.mockResolvedValue(reply(201));
    await push.sendToUser(user.id, MSG);
    const [, init] = safeFetchFollow.mock.calls[0];
    expect(init.headers[BACKGROUND_PUSH_HEADER]).toBeUndefined();
    expect(init.headers.TTL).toBe(String(24 * 60 * 60));
  });

  it("WSYNC-011: only the relay's APNs endpoints count as an iPhone", () => {
    expect(isAppleRelayEndpoint(APNS)).toBe(true);
    expect(isAppleRelayEndpoint(FCM)).toBe(false);
    expect(isAppleRelayEndpoint(BROWSER)).toBe(false);
    expect(isAppleRelayEndpoint(`http://push.liketrek.com/v1/apns/production/${'ab'.repeat(32)}`)).toBe(false);
    expect(isAppleRelayEndpoint('not a url')).toBe(false);
  });
});

describe('buildPushPayload', () => {
  const size = (p: unknown) => Buffer.byteLength(JSON.stringify(p), 'utf8');

  it('WPUSH-PAY-001: passes a short message through; chat collapses per trip', () => {
    expect(buildPushPayload(MSG)).toEqual({
      title: MSG.title,
      body: MSG.body,
      url: '/trips/12',
      tag: 'collab_message:/trips/12',
      event: 'collab_message',
    });
    // Without a trip to collapse on there is no tag at all, never one for every chat everywhere.
    expect(buildPushPayload({ ...MSG, navigateTarget: undefined })).toEqual({
      title: MSG.title,
      body: MSG.body,
      event: 'collab_message',
    });
  });

  it('WPUSH-PAY-001b: every other event has no tag, so two of them never replace each other', () => {
    const others = ALL_EVENT_TYPES.filter((event) => event !== 'collab_message');
    expect(others.length).toBeGreaterThan(5);
    for (const event of others) {
      const payload = buildPushPayload({ ...MSG, event });
      expect(payload, event).toEqual({ title: MSG.title, body: MSG.body, url: '/trips/12', event });
      expect(payload, event).not.toHaveProperty('tag');
    }
  });

  it('WPUSH-PAY-002: cuts a long body at a character boundary until the payload fits', () => {
    const payload = buildPushPayload({ ...MSG, body: '🚄'.repeat(5000) });
    expect(size(payload)).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(size(payload)).toBeGreaterThan(MAX_PUSH_PAYLOAD_BYTES - 8);
    expect(payload.body.endsWith('…')).toBe(true);
    expect(payload.body.slice(0, -1)).toMatch(/^(🚄)+$/u);
  });

  it('WPUSH-PAY-003: characters JSON has to escape are counted as what they cost', () => {
    const payload = buildPushPayload({ ...MSG, title: '\u0001'.repeat(500), body: '"\u0002'.repeat(3000) });
    expect(size(payload)).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(Array.from(payload.title)).toHaveLength(120);
    expect(payload.body.length).toBeGreaterThan(0);
  });

  it('WPUSH-PAY-004: only same-origin paths reach the worker', () => {
    expect(samePagePath('/trips/5')).toBe('/trips/5');
    expect(samePagePath('/admin?tab=storage')).toBe('/admin?tab=storage');
    for (const target of [
      'https://evil.test/x',
      '//evil.test/x',
      '/\\evil.test',
      'trips/5',
      '/trips/5 x',
      `/${'a'.repeat(300)}`,
      '',
      undefined,
    ]) {
      expect(samePagePath(target), String(target)).toBeUndefined();
    }
    expect(buildPushPayload({ ...MSG, navigateTarget: 'https://evil.test/' })).not.toHaveProperty('url');
  });
});
