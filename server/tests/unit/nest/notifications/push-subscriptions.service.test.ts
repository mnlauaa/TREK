import { checkPushSubscription } from '../../../../src/nest/notifications/push/push-subscription.helpers';
import { webPushSubscriptionSchema } from '@trek/shared';

import { createECDH } from 'node:crypto';
import { describe, it, expect } from 'vitest';

const endpoint = 'https://push.example.test:8443/push';
const browser = createECDH('prime256v1');
browser.generateKeys();
const keys = { p256dh: browser.getPublicKey('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') };

describe('checkPushSubscription', () => {
  it('accepts HTTPS push providers and decodes their keys', () => {
    const input = webPushSubscriptionSchema.parse({ endpoint, keys });
    expect(checkPushSubscription(input)).toEqual({
      ok: true,
      value: { endpoint, p256dh: browser.getPublicKey(), auth: Buffer.alloc(16, 9) },
    });
  });

  it('rejects endpoint credentials, even over HTTPS', () => {
    const input = webPushSubscriptionSchema.parse({ endpoint: 'https://user:pass@push.example.test', keys });
    expect(checkPushSubscription(input)).toEqual({ ok: false, error: 'Invalid push endpoint' });
  });

  it('rejects keys that cannot encrypt a push message', () => {
    expect(
      checkPushSubscription({ endpoint, keys: { ...keys, p256dh: Buffer.alloc(65, 4).toString('base64url') } }),
    ).toEqual({ ok: false, error: 'Invalid push subscription key' });
    expect(checkPushSubscription({ endpoint, keys: { ...keys, auth: Buffer.alloc(8).toString('base64url') } })).toEqual(
      { ok: false, error: 'Invalid push subscription auth secret' },
    );
  });
});
