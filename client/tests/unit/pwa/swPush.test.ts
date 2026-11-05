import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'public/sw-push.js'), 'utf8');
const origin = 'https://trek.example';
const payload = {
  v: 1,
  recipientUserId: 42,
  title: 'Trip updated',
  body: 'The hotel changed',
  path: '/trips/6?tab=bookings',
  unreadCount: 3,
  tag: 'chat:6',
};

function worker(activeUser: number | undefined) {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {};
  const window = { url: origin, postMessage: vi.fn(), navigate: vi.fn(), focus: vi.fn() };
  const clients = {
    matchAll: vi.fn().mockResolvedValue([window]),
    openWindow: vi.fn(),
  };
  const showNotification = vi.fn();
  const setAppBadge = vi.fn();
  const clearAppBadge = vi.fn();
  const request = (result: unknown) => {
    const pending = { result, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => pending.onsuccess?.());
    return pending;
  };
  runInNewContext(source, {
    URL,
    indexedDB: {
      open: () =>
        request({
          close() {},
          transaction: () => ({ objectStore: () => ({ get: () => request(activeUser) }) }),
        }),
    },
    self: {
      location: { origin },
      registration: { showNotification },
      navigator: { setAppBadge, clearAppBadge },
      clients,
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
        handlers[name] = handler;
      },
    },
  });
  const fire = async (type: string, data: Record<string, unknown>) => {
    let pending: Promise<unknown> | undefined;
    handlers[type]({
      ...data,
      waitUntil: (work: Promise<unknown>) => {
        pending = work;
      },
    });
    expect(pending).toBeDefined();
    await pending;
  };
  return { fire, window, clients, showNotification, setAppBadge, clearAppBadge };
}

describe('encrypted device Web Push worker', () => {
  it('shows and badges a matching recipient and coalesces chat messages', async () => {
    const sw = worker(42);
    await sw.fire('push', { data: { json: () => payload } });
    expect(sw.showNotification).toHaveBeenCalledWith(
      payload.title,
      expect.objectContaining({
        body: payload.body,
        data: { path: payload.path },
        tag: payload.tag,
        renotify: true,
      }),
    );
    expect(sw.setAppBadge).toHaveBeenCalledWith(3);
  });

  it.each([undefined, 24])('conceals content and badge for a different or signed out user (%s)', async (active) => {
    const sw = worker(active);
    await sw.fire('push', { data: { json: () => payload } });
    expect(sw.showNotification).toHaveBeenCalledWith(
      'TREK',
      expect.objectContaining({ body: 'Sign in to view your notification.', data: { path: '/' } }),
    );
    expect(sw.showNotification.mock.calls[0][1]).not.toHaveProperty('tag');
    expect(sw.setAppBadge).not.toHaveBeenCalled();
    expect(sw.clearAppBadge).not.toHaveBeenCalled();
  });

  it('keeps malformed and pre-upgrade payloads private while still showing a notification', async () => {
    const sw = worker(42);
    await sw.fire('push', { data: { json: () => ({ title: payload.title, body: payload.body }) } });
    expect(sw.showNotification.mock.calls[0][0]).toBe('TREK');
  });

  it('never opens a different origin from a notification click', async () => {
    const sw = worker(42);
    const close = vi.fn();
    await sw.fire('notificationclick', { notification: { close, data: { path: '//evil.example' } } });
    expect(close).toHaveBeenCalledOnce();
    expect(sw.window.navigate).toHaveBeenCalledWith(`${origin}/`);
    expect(sw.clients.openWindow).not.toHaveBeenCalled();
    await sw.fire('notificationclick', { notification: { close, data: { path: payload.path } } });
    expect(sw.window.navigate).toHaveBeenLastCalledWith(origin + payload.path);
  });

  it('lets the authenticated app reconcile a changed browser subscription', async () => {
    const sw = worker(42);
    await sw.fire('pushsubscriptionchange', {});
    expect(sw.window.postMessage).toHaveBeenCalledWith({ type: 'trek:web-push-subscription-changed' });
  });
});
