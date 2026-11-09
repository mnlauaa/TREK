import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPushCutover, rememberPushEndpoint } from './pushCutoverState';
import { retireForkPush } from './retireForkPush';

let unsubscribe: ReturnType<typeof vi.fn>;
let getRegistration: ReturnType<typeof vi.fn>;
let current: { unsubscribe: ReturnType<typeof vi.fn> } | null;

beforeEach(() => {
  localStorage.clear();
  let receipt: Response | undefined;
  vi.stubGlobal('caches', {
    match: vi.fn(async () => receipt?.clone()),
    open: vi.fn(async () => ({
      put: async (_key: string, value: Response) => {
        receipt = value;
      },
    })),
  });
  unsubscribe = vi.fn(async () => {
    current = null;
    return true;
  });
  current = { unsubscribe };
  getRegistration = vi.fn(async () => ({ pushManager: { getSubscription: async () => current } }));
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration } });
  let queue: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: vi.fn((_name, optionsOrTask, task) => {
        const next = queue.then(task ?? optionsOrTask);
        queue = next.then(
          () => undefined,
          () => undefined
        );
        return next;
      }),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'locks');
});

describe('one-time retirement of fork browser push', () => {
  it('retires an existing endpoint even if old localStorage markers were lost', async () => {
    expect(await retireForkPush()).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(await readPushCutover()).toEqual({ retired: true, endpoint: null });
    current = { unsubscribe: vi.fn() };
    expect(await retireForkPush()).toBe(true);
    expect(current.unsubscribe).not.toHaveBeenCalled();
  });

  it('clears old enabled/install markers only after successful retirement', async () => {
    localStorage.setItem('trek_web_push_installation_id', 'old-device');
    localStorage.setItem('trek_web_push_enabled', '1');
    unsubscribe.mockResolvedValueOnce(false);
    expect(await retireForkPush()).toBe(false);
    expect(await readPushCutover()).toBeNull();
    expect(localStorage.getItem('trek_web_push_enabled')).toBe('1');
    expect(await retireForkPush()).toBe(true);
    expect(localStorage.getItem('trek_web_push_enabled')).toBeNull();
    expect(localStorage.getItem('trek_web_push_installation_id')).toBeNull();
  });

  it('shares cleanup across callers and serializes separate module instances', async () => {
    vi.resetModules();
    const other = await import('./retireForkPush');
    expect(await Promise.all([retireForkPush(), retireForkPush(), other.retireForkPush()])).toEqual([true, true, true]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('times out without later unsubscribing or marking the device complete', async () => {
    vi.useFakeTimers();
    let finish: (value: unknown) => void = () => undefined;
    getRegistration.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const result = retireForkPush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe(false);
    finish({ pushManager: { getSubscription: async () => current } });
    await vi.advanceTimersByTimeAsync(0);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(await readPushCutover()).toBeNull();
    expect(await retireForkPush()).toBe(true);
  });

  it('keeps a timed-out write locked until it settles, before a newer enrollment can write', async () => {
    vi.useFakeTimers();
    const cache = await caches.open('trek-push-cutover');
    let finish: (cache: Cache) => void = () => undefined;
    vi.mocked(caches.open).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const retirement = retireForkPush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await retirement).toBe(false);
    const enrollment = rememberPushEndpoint('https://push.example/new-device');
    finish(cache);
    await vi.advanceTimersByTimeAsync(0);
    await enrollment;
    expect(await readPushCutover()).toEqual({ retired: true, endpoint: 'https://push.example/new-device' });
  });

  it('completes when no old registration exists', async () => {
    getRegistration.mockResolvedValueOnce(undefined);
    expect(await retireForkPush()).toBe(true);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('fails closed when storage or cross-tab locking is unavailable', async () => {
    vi.mocked(caches.match).mockRejectedValueOnce(new Error('blocked'));
    expect(await retireForkPush()).toBe(false);
    Reflect.deleteProperty(navigator, 'locks');
    expect(await retireForkPush()).toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
