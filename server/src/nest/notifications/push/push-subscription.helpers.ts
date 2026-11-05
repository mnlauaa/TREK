import { decodeBase64Url } from '../../../app-config';
import { isP256Point } from './web-push-crypto';
import type { WebPushSubscription } from '@trek/shared';

export interface CheckedPushSubscription {
  endpoint: string;
  p256dh: Buffer;
  auth: Buffer;
}

type PushSubscriptionCheck = { ok: true; value: CheckedPushSubscription } | { ok: false; error: string };

export function checkPushSubscription(input: WebPushSubscription): PushSubscriptionCheck {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    return { ok: false, error: 'Invalid push endpoint' };
  }

  const p256dh = decodeBase64Url(input.keys.p256dh);
  if (!p256dh || !isP256Point(p256dh)) return { ok: false, error: 'Invalid push subscription key' };

  const auth = decodeBase64Url(input.keys.auth);
  if (auth?.length !== 16) return { ok: false, error: 'Invalid push subscription auth secret' };

  return { ok: true, value: { endpoint: input.endpoint, p256dh, auth } };
}
