import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationsApi } from '../api/client';
import { enableWebPush, forgetWebPushOnLogout, getWebPushInstallationId, reconcileWebPush } from './webPush';

const config = { enabled: true, available: true, publicKey: 'AQID', maxDevices: 10 };
const subscriptionJson = {
  endpoint: 'https://push.example/message',
  keys: { p256dh: 'abcdef012345', auth: 'abcdef012345' },
};

const subscription = {
  options: { applicationServerKey: Uint8Array.from([1, 2, 3]).buffer },
  unsubscribe: vi.fn(async () => true),
  toJSON: () => subscriptionJson,
};

const pushManager = { getSubscription: vi.fn(), subscribe: vi.fn() };
const originalWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

beforeEach(() => {
  localStorage.removeItem('trek_web_push_installation_id');
  localStorage.removeItem('trek_web_push_enabled');
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
  pushManager.getSubscription.mockResolvedValue(subscription);
  pushManager.subscribe.mockResolvedValue(subscription);
  const registration = { pushManager };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration), getRegistration: async () => registration },
  });
});

afterEach(() => {
  if (originalWorker) Object.defineProperty(navigator, 'serviceWorker', originalWorker);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('device Web Push', () => {
  it('asks permission from the enable action and registers the encrypted lifecycle once', async () => {
    const permission = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: permission });
    const register = vi.spyOn(notificationsApi, 'webPushCurrent').mockResolvedValue({ state: 'active' });

    await expect(enableWebPush(config)).resolves.toEqual({ state: 'active' });
    expect(permission).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith({
      intent: 'enable',
      installationId: getWebPushInstallationId(),
      label: expect.any(String),
      subscription: subscriptionJson,
    });
    expect(localStorage.getItem('trek_web_push_enabled')).toBe('1');
  });

  it('does not register from an alias of the configured origin', async () => {
    const register = vi.spyOn(notificationsApi, 'webPushCurrent');
    await expect(enableWebPush({ ...config, canonicalOrigin: 'https://other.example' })).rejects.toThrow(/origin/);
    expect(register).not.toHaveBeenCalled();
  });

  it('only reconciles opted-in devices, replaces stale keys, and honors remote revocation', async () => {
    const loadConfig = vi.spyOn(notificationsApi, 'webPushConfig').mockResolvedValue(config);
    const register = vi.spyOn(notificationsApi, 'webPushCurrent').mockResolvedValue({ state: 'revoked' });
    expect(await reconcileWebPush()).toBeNull();
    expect(loadConfig).not.toHaveBeenCalled();

    localStorage.setItem('trek_web_push_enabled', '1');
    const stale = {
      ...subscription,
      options: { applicationServerKey: Uint8Array.from([8, 8, 8]).buffer },
      unsubscribe: vi.fn(async () => true),
    };
    pushManager.getSubscription.mockResolvedValueOnce(stale);
    await expect(reconcileWebPush()).resolves.toEqual({ state: 'revoked' });
    expect(stale.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from([1, 2, 3]),
    });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ intent: 'reconcile' }));
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem('trek_web_push_enabled')).toBeNull();
  });

  it('releases only the active installation before sign-out', async () => {
    localStorage.setItem('trek_web_push_enabled', '1');
    const installationId = getWebPushInstallationId();
    const device = {
      id: 9,
      installationId,
      label: 'Desktop',
      createdAt: '2026-10-01T03:00:00Z',
      lastSeenAt: '2026-10-01T03:00:00Z',
      lastSuccessAt: null,
    };
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ devices: [device] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await forgetWebPushOnLogout();
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      '/api/notifications/web-push/devices',
      '/api/notifications/web-push/devices/9',
    ]);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE', credentials: 'same-origin' });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});
