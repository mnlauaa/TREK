import { DatabaseService } from '../../../src/nest/database/database.service';
import {
  MAX_WEB_PUSH_DEVICES,
  WebPushService,
  WebPushServiceError,
} from '../../../src/nest/notifications/web-push.service';
import { safeFetchFollow } from '../../../src/utils/ssrfGuard';
import { createTestDb } from '../../helpers/test-db';

import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';

vi.mock('../../../src/utils/ssrfGuard', () => ({ safeFetchFollow: vi.fn() }));

describe('WebPushService', () => {
  let db: Database.Database;
  let service: WebPushService;
  let userId: number;
  const writeAudit = vi.fn();
  const originalEnv = {
    APP_URL: process.env.APP_URL,
    NODE_ENV: process.env.NODE_ENV,
    WEB_PUSH_VAPID_PUBLIC_KEY: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
    WEB_PUSH_VAPID_PRIVATE_KEY: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    WEB_PUSH_VAPID_SUBJECT: process.env.WEB_PUSH_VAPID_SUBJECT,
  };

  const subscription = (suffix = '1') => ({
    endpoint: `https://push.example.test/subscription/${suffix}`,
    keys: { p256dh: 'abcdefgh_12345678', auth: 'abcdefgh_12345678' },
  });

  const register = (suffix = '1', intent: 'enable' | 'reconcile' = 'enable') =>
    service.registerCurrent(userId, {
      intent,
      installationId: `123e4567-e89b-42d3-a456-4266141740${suffix.padStart(2, '0')}`,
      label: `Device ${suffix}`,
      subscription: subscription(suffix),
    });

  beforeEach(() => {
    process.env.APP_URL = 'https://trek.example.test';
    db = createTestDb();
    const dbs = new DatabaseService(db);
    service = new WebPushService(dbs, { writeAudit } as never);
    userId = Number(
      db
        .prepare(
          "INSERT INTO users (username,email,password_hash,role) VALUES ('admin','admin@example.test','x','admin')",
        )
        .run().lastInsertRowid,
    );
    db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('notification_channels','webpush')").run();
    vi.mocked(safeFetchFollow).mockReset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    writeAudit.mockReset();
    vi.restoreAllMocks();
    db.close();
  });

  it('generates one durable VAPID identity and registers/revokes a device', () => {
    const firstConfig = service.config();
    const secondConfig = service.config();
    expect(firstConfig).toMatchObject({ enabled: true, available: true, canonicalOrigin: 'https://trek.example.test' });
    expect(secondConfig.publicKey).toBe(firstConfig.publicKey);

    const enabled = service.registerCurrent(userId, {
      intent: 'enable',
      installationId: '123e4567-e89b-42d3-a456-426614174000',
      label: 'Safari on iPhone',
      subscription: subscription(),
    });
    expect(enabled.state).toBe('active');
    expect(service.listDevices(userId)).toHaveLength(1);
    expect(db.prepare('SELECT subscription_encrypted FROM web_push_subscriptions').get()).not.toEqual({
      subscription_encrypted: expect.stringContaining('push.example.test'),
    });

    expect(service.revokeDevice(userId, enabled.device!.id)).toBe(true);
    expect(service.listDevices(userId)).toEqual([]);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'web_push.device_revoke' }));
  });

  it('validates the canonical origin and reports unavailable configuration without throwing from config()', () => {
    delete process.env.APP_URL;
    expect(() => service.canonicalOrigin()).toThrowError(
      expect.objectContaining({ code: 'WEB_PUSH_ORIGIN_UNAVAILABLE', status: 503 }),
    );
    expect(service.config()).toMatchObject({ enabled: true, available: false, maxDevices: MAX_WEB_PUSH_DEVICES });

    process.env.APP_URL = 'not a URL';
    expect(() => service.canonicalOrigin()).toThrow(/valid URL/);
    process.env.APP_URL = 'http://trek.example.test';
    process.env.NODE_ENV = 'production';
    expect(() => service.canonicalOrigin()).toThrow(/HTTPS/);
    process.env.APP_URL = 'http://localhost:3000';
    process.env.NODE_ENV = 'development';
    expect(service.canonicalOrigin()).toBe('http://localhost:3000');
  });

  it('honours channel lists, rejects half-configured VAPID overrides, and accepts a complete override', () => {
    db.prepare("UPDATE app_settings SET value='email, webpush' WHERE key='notification_channels'").run();
    expect(service.isAdminEnabled()).toBe(true);
    db.prepare("UPDATE app_settings SET value='none' WHERE key='notification_channels'").run();
    expect(service.isAdminEnabled()).toBe(false);
    db.prepare("DELETE FROM app_settings WHERE key='notification_channels'").run();
    db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('notification_channel','webpush')").run();
    expect(service.isAdminEnabled()).toBe(true);

    const generated = webpush.generateVAPIDKeys();
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = generated.publicKey;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    expect(service.config()).toMatchObject({ available: false, error: expect.stringContaining('configured together') });
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = generated.privateKey;
    expect(service.config()).toMatchObject({ available: true, publicKey: generated.publicKey });
    expect(db.prepare("SELECT value FROM app_settings WHERE key='web_push_vapid_public_key'").get()).toEqual({
      value: generated.publicKey,
    });
  });

  it('reconciles missing devices as revoked, updates an existing device, and revokes endpoint conflicts', () => {
    expect(register('1', 'reconcile')).toEqual({ state: 'revoked' });
    const first = register('1');
    expect(register('1', 'reconcile')).toMatchObject({ state: 'active', device: { id: first.device!.id } });
    expect(service.renameDevice(userId, first.device!.id, '  Renamed  ')).toMatchObject({ label: 'Renamed' });
    expect(service.renameDevice(userId, 99999, 'missing')).toBeNull();
    expect(service.revokeDevice(userId, 99999)).toBe(false);

    const otherId = Number(
      db
        .prepare(
          "INSERT INTO users (username,email,password_hash,role) VALUES ('other','other@example.test','x','user')",
        )
        .run().lastInsertRowid,
    );
    service.registerCurrent(otherId, {
      intent: 'enable',
      installationId: '223e4567-e89b-42d3-a456-426614174001',
      label: 'Other device',
      subscription: subscription('1'),
    });
    expect(db.prepare('SELECT status FROM web_push_subscriptions WHERE id=?').get(first.device!.id)).toEqual({
      status: 'revoked',
    });
  });

  it('enforces the active-device limit and invalidates devices after an origin change', () => {
    for (let index = 0; index < MAX_WEB_PUSH_DEVICES; index += 1) register(String(index + 1));
    expect(() => register('99')).toThrowError(expect.objectContaining({ code: 'WEB_PUSH_DEVICE_LIMIT', status: 409 }));
    process.env.APP_URL = 'https://new-origin.example.test';
    expect(service.listDevices(userId)).toEqual([]);
    expect(
      (
        db.prepare("SELECT COUNT(*) AS count FROM web_push_subscriptions WHERE status='origin_mismatch'").get() as {
          count: number;
        }
      ).count,
    ).toBe(MAX_WEB_PUSH_DEVICES);
  });

  it('refuses registration while the administrator has Web Push disabled', () => {
    db.prepare("UPDATE app_settings SET value='none' WHERE key='notification_channels'").run();
    expect(() => register()).toThrowError(expect.objectContaining({ code: 'WEB_PUSH_DISABLED', status: 409 }));
    expect(service.hasActiveSubscription(userId)).toBe(false);
  });

  it('reports active subscriptions and converts SQLite timestamps to ISO form', () => {
    const device = register().device!;
    expect(service.hasActiveSubscription(userId)).toBe(true);
    expect(service.listDevices(userId)[0]).toMatchObject({
      id: device.id,
      createdAt: expect.stringMatching(/Z$/),
      lastSeenAt: expect.stringMatching(/Z$/),
      lastSuccessAt: null,
    });
    process.env.APP_URL = '';
    expect(service.hasActiveSubscription(userId)).toBe(false);
  });

  describe('delivery', () => {
    const message = {
      event: 'trip_invite' as const,
      title: 'T'.repeat(300),
      body: 'Body '.repeat(1000),
      navigateTarget: 'https://outside.example.test',
    };

    beforeEach(() => {
      register();
      vi.spyOn(webpush, 'generateRequestDetails').mockReturnValue({
        endpoint: 'https://push.example.test/send',
        method: 'POST',
        headers: { authorization: 'redacted' },
        body: Buffer.from('ciphertext'),
      } as never);
    });

    it('sends a bounded privacy-safe payload and records successful delivery', async () => {
      vi.mocked(safeFetchFollow).mockResolvedValue({ status: 201, body: { cancel: vi.fn(async () => {}) } } as never);
      await expect(service.sendToUser(userId, message)).resolves.toEqual({ sent: 1, failed: 0, invalid: 0 });
      const payload = vi.mocked(webpush.generateRequestDetails).mock.calls[0][1] as string;
      expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(3072);
      expect(JSON.parse(payload)).toMatchObject({ recipientUserId: userId, path: '/', unreadCount: 0 });
      expect(vi.mocked(webpush.generateRequestDetails).mock.calls[0][2]).toMatchObject({ urgency: 'high' });
      expect(db.prepare('SELECT last_success_at,last_error_at FROM web_push_subscriptions').get()).toMatchObject({
        last_success_at: expect.any(String),
        last_error_at: null,
      });
    });

    it.each([
      [410, { sent: 0, failed: 0, invalid: 1 }, 'invalid'],
      [500, { sent: 0, failed: 1, invalid: 0 }, 'active'],
    ] as const)('maps a %i provider response to the expected delivery state', async (status, expected, rowStatus) => {
      vi.mocked(safeFetchFollow).mockResolvedValue({ status, body: null } as never);
      await expect(service.sendToUser(userId, { ...message, event: 'plugin_notification' })).resolves.toEqual(expected);
      expect(db.prepare('SELECT status FROM web_push_subscriptions').get()).toEqual({ status: rowStatus });
    });

    it('marks malformed encrypted subscriptions invalid without making a request', async () => {
      db.prepare("UPDATE web_push_subscriptions SET subscription_encrypted='not encrypted json'").run();
      await expect(service.sendToUser(userId, message)).resolves.toEqual({ sent: 0, failed: 0, invalid: 1 });
      expect(safeFetchFollow).not.toHaveBeenCalled();
    });

    it('contains provider exceptions as failed deliveries', async () => {
      vi.mocked(safeFetchFollow).mockRejectedValueOnce(new Error('offline'));
      await expect(service.sendToUser(userId, message)).resolves.toEqual({ sent: 0, failed: 1, invalid: 0 });
      expect(db.prepare('SELECT last_error_at FROM web_push_subscriptions').get()).toMatchObject({
        last_error_at: expect.any(String),
      });
    });

    it('short-circuits disabled delivery and tests only devices owned by the caller', async () => {
      const id = service.listDevices(userId)[0].id;
      vi.mocked(safeFetchFollow).mockResolvedValue({ status: 201, body: null } as never);
      await expect(service.testDevice(userId, id)).resolves.toEqual({ success: true });
      await expect(service.testDevice(userId, 99999)).resolves.toEqual({ success: false, error: 'Not found' });
      vi.mocked(safeFetchFollow).mockResolvedValueOnce({ status: 500, body: null } as never);
      await expect(service.testDevice(userId, id)).resolves.toEqual({
        success: false,
        error: 'Web Push test failed',
      });
      db.prepare("UPDATE app_settings SET value='none' WHERE key='notification_channels'").run();
      await expect(service.sendToUser(userId, message)).resolves.toEqual({ sent: 0, failed: 0, invalid: 0 });
      await expect(service.testDevice(userId, id)).resolves.toEqual({
        success: false,
        error: 'Web Push is disabled by the administrator',
      });
      expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'web_push.device_test' }));
    });
  });
});
