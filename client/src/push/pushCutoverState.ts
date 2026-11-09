const CACHE = 'trek-push-cutover';
const KEY = '/__trek_push_upstream511';

export interface PushCutoverState {
  retired: boolean;
  endpoint: string | null;
}

export async function readPushCutover(): Promise<PushCutoverState | null> {
  const response = await bounded(caches.match(KEY, { cacheName: CACHE }));
  return response ? ((await response.json()) as PushCutoverState) : null;
}

export async function writePushCutover(state: PushCutoverState): Promise<void> {
  const cache = await caches.open(CACHE);
  await cache.put(KEY, new Response(JSON.stringify(state)));
}

export async function isEnrolledPushEndpoint(endpoint: string): Promise<boolean> {
  try {
    const state = await readPushCutover();
    return state?.retired === true && state.endpoint === endpoint;
  } catch {
    return false;
  }
}

export async function rememberPushEndpoint(endpoint: string | null): Promise<void> {
  if (!navigator.locks) throw new Error('Push cutover locking is unavailable');
  await bounded(navigator.locks.request('trek-push-cutover', () => writePushCutover({ retired: true, endpoint })));
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Push cutover storage timed out')), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
