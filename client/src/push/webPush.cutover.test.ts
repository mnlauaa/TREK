import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushApi } from '../api/push';
import { readPushCutover, writePushCutover } from './pushCutoverState';
import { enableWebPush, readWebPushDeviceState, resyncPushSubscription } from './webPush';

vi.mock('../api/push', () => ({ pushApi: { subscribe: vi.fn(), getPublicKey: vi.fn() } }));
vi.mock('../sync/networkMode', () => ({ isEffectivelyOffline: () => false }));
vi.mock('../native/push', () => ({ nativePushActive: () => false }));

let current: PushSubscription | null;
let registration: ServiceWorkerRegistration;
const key = 'BAECAwQ';
function subscription(endpoint: string): PushSubscription {
  return {
    endpoint,
    options: { applicationServerKey: new Uint8Array([4, 1, 2, 3, 4]).buffer },
    unsubscribe: vi.fn(async () => {
      current = null;
      return true;
    }),
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  } as unknown as PushSubscription;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  let receipt: Response | undefined;
  vi.stubGlobal('caches', {
    match: async () => receipt?.clone(),
    open: async () => ({
      put: async (_key: string, value: Response) => {
        receipt = value;
      },
    }),
  });
  current = subscription('https://push.example/legacy-revoked');
  registration = {
    pushManager: {
      getSubscription: async () => current,
      subscribe: async () => {
        current = subscription('https://push.example/enrolled');
        return current;
      },
    },
  } as unknown as ServiceWorkerRegistration;
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => registration,
      ready: Promise.resolve(registration),
    },
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, optionsOrTask: unknown, task?: () => Promise<boolean>) =>
        task ? task() : (optionsOrTask as () => Promise<void>)(),
    },
  });
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('isSecureContext', true);
  vi.mocked(pushApi.subscribe).mockResolvedValue({ success: true, devices: 1 });
  vi.mocked(pushApi.getPublicKey).mockResolvedValue({ publicKey: key });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'locks');
});

describe('upstream registration after fork retirement', () => {
  it('retires without resubscribing, then records only an explicit enable for future resync', async () => {
    await resyncPushSubscription();
    expect(pushApi.subscribe).not.toHaveBeenCalled();
    expect(await readWebPushDeviceState()).toBe('off');
    await enableWebPush(key, registration);
    expect(pushApi.subscribe).toHaveBeenCalledOnce();
    expect(await readPushCutover()).toEqual({ retired: true, endpoint: 'https://push.example/enrolled' });
    expect(await readWebPushDeviceState()).toBe('on');
    await resyncPushSubscription();
    expect(pushApi.subscribe).toHaveBeenCalledTimes(2);
  });

  it('does not restore an unrecognized endpoint even after cleanup completed', async () => {
    await writePushCutover({ retired: true, endpoint: 'https://push.example/enrolled' });
    await resyncPushSubscription();
    expect(pushApi.subscribe).not.toHaveBeenCalled();
    expect(await readWebPushDeviceState()).toBe('off');
  });

  it('fails closed if retirement cannot lock the old browser registration', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    await resyncPushSubscription();
    await expect(enableWebPush(key, registration)).rejects.toMatchObject({ code: 'failed' });
    expect(pushApi.subscribe).not.toHaveBeenCalled();
  });
});
