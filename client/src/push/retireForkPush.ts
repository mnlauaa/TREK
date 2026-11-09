import { readPushCutover, writePushCutover } from './pushCutoverState';
let pending: Promise<boolean> | undefined;

/** Retire old browser registrations once, before upstream can restore them after login. */
export function retireForkPush(): Promise<boolean> {
  pending ??= retireWithLock().finally(() => {
    pending = undefined;
  });
  return pending;
}

async function retireWithLock(): Promise<boolean> {
  try {
    if ((await readPushCutover())?.retired) return true;
  } catch {
    return false;
  }
  if (!navigator.locks) return false;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const cleanup = navigator.locks
      .request('trek-push-cutover', { signal: controller.signal }, async () => {
        if (expired) return false;
        if ((await readPushCutover())?.retired) return true;
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (expired) return false;
        if (subscription) {
          await subscription.unsubscribe();
          if (await registration?.pushManager.getSubscription()) return false;
        }
        if (expired) return false;
        localStorage.removeItem('trek_web_push_installation_id');
        localStorage.removeItem('trek_web_push_enabled');
        await writePushCutover({ retired: true, endpoint: null });
        return true;
      })
      .catch(() => false);
    return await Promise.race([
      cleanup,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          controller.abort();
          resolve(false);
        }, 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
