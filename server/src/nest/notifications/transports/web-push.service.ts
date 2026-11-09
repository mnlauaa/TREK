import { readEnv } from '../../../app-config';
import { Notifications } from '../../../db/entities/Notifications.entity';
import { WebPushSubscriptions } from '../../../db/entities/WebPushSubscriptions.entity';
import type { NotificationsRepository } from '../../../db/repositories/Notifications.repository';
import type {
  WebPushDeviceRow,
  WebPushDeviceScope,
  WebPushSubscriptionsRepository,
} from '../../../db/repositories/WebPushSubscriptions.repository';
import { discardBody } from '../../../utils/cappedFetch';
import { safeFetchFollow } from '../../../utils/ssrfGuard';
import { logError } from '../../audit/audit-log.logger';
import { AuditService } from '../../audit/audit.service';
import { decrypt_api_key, encrypt_api_key, is_encrypted_api_key } from '../../common/crypto/apiKeyCrypto';
import { UnitOfWork } from '../../database/unit-of-work';
import type { ChannelMessage } from '../notification-events';
import { NotificationPreferencesService } from '../notification-preferences.service';
import { checkPushSubscription } from '../push/push-subscription.helpers';
import { PushUnavailableError, VapidKeysService, type ResolvedVapidKeys } from '../push/vapid-keys.service';
import { createVapidSigner, encryptPushMessage, type VapidSigner } from '../push/web-push-crypto';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';
import {
  WEB_PUSH_CHANNEL_ID,
  webPushSubscriptionSchema,
  type ChannelTestResult,
  type PushPayload,
  type WebPushConfigResult,
  type WebPushCurrentRequest,
  type WebPushCurrentResult,
  type WebPushDevice,
} from '@trek/shared';

import { createHash } from 'node:crypto';

/**
 * Ceiling for the JSON the service worker receives. A single aes128gcm record
 * can carry just under 4 KB and some push services refuse anything larger, so
 * the payload stays well clear of that and the body gives way first.
 *
 * The apps' relay (push.liketrek.com) is the tightest: it carries the encrypted
 * record base64-encoded inside an APNs payload, which Apple caps at 4096 bytes.
 * 2800 bytes of JSON become about 3870 there, with room for the APNs envelope.
 */
export const MAX_PUSH_PAYLOAD_BYTES = 2800;

const TITLE_MAX_CHARS = 120;
/** A navigate target is an app path like /trips/12; anything longer is not one. */
const URL_MAX_LENGTH = 256;
const ELLIPSIS = '…';

const PUSH_TIMEOUT_MS = 10_000;
/** A day: a reminder that reaches a phone after a longer flight is still worth showing, a week-old one is not. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const COLLAPSING_EVENT = 'collab_message';

type Urgency = 'low' | 'normal' | 'high';

/**
 * The watch sync (WatchSyncPushService): a silent push to the TREK iPhone app
 * that a packing list or the to-dos of one of its trips changed, so the app can
 * refresh its Apple Watch while it is in the background. The relay sends it as
 * an APNs background push (content-available, no alert) when it carries this
 * header; the record itself says nothing beyond that.
 */
export const BACKGROUND_PUSH_HEADER = 'X-Trek-Push';
const WATCH_SYNC_PAYLOAD = Buffer.from(JSON.stringify({ type: 'watch-sync' }), 'utf8');
/** A refresh that arrives ten minutes late is stale; the next change sends another. */
const WATCH_SYNC_TTL_SECONDS = 10 * 60;
/** Later syncs replace a queued one at Apple: only the newest state matters. */
const WATCH_SYNC_TOPIC = 'trek-watch-sync';

/** The relay's APNs endpoints, the only devices with a watch to refresh. */
export function isAppleRelayEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && url.hostname === 'push.liketrek.com' && url.pathname.startsWith('/v1/apns/');
  } catch {
    return false;
  }
}

interface DeliveryOptions {
  ttlSeconds?: number;
  /** Sent as a background push by the relay, never shown. */
  background?: boolean;
}
/** The events that are about a date, where arriving late defeats the point (RFC 8030 section 5.3). */
const HIGH_URGENCY_EVENTS: ReadonlySet<string> = new Set([
  'trip_invite',
  'booking_change',
  'trip_reminder',
  'todo_due',
  'vacay_invite',
  'collection_invite',
]);

/** No tag either: two presses of Send test are two notifications, like two of anything but chat. */
/**
 * The target the worker may open: a path on this origin only. Absolute URLs
 * and protocol-relative ones (`//host`, `/\host`) would take the click to
 * another site, so they are dropped rather than passed on.
 */
export function samePagePath(target: string | undefined): string | undefined {
  if (!target || target.length > URL_MAX_LENGTH) return undefined;
  if (!/^\/(?![/\\])[\x21-\x7e]*$/.test(target)) return undefined;
  return target;
}

function truncateChars(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}${ELLIPSIS}`;
}

function payloadBytes(payload: PushPayload): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

/**
 * The rendered notification as the service worker gets it. Title and body are
 * already in the recipient's language; the worker has no translations. Only
 * chat messages carry a tag, `collab_message:<trip path>`, so a burst of them in
 * one trip shows as one notification that keeps updating instead of a pile of
 * them. Everything else has no tag and never replaces an earlier notification.
 * The event goes along so the Android app can sort it into a channel.
 *
 * The body is cut, at a character boundary and with an ellipsis, until the
 * JSON fits MAX_PUSH_PAYLOAD_BYTES. The title and the path are capped first, so
 * whatever they are, the body always keeps room of its own.
 */
export function buildPushPayload(
  msg: Pick<ChannelMessage, 'event' | 'title' | 'body' | 'navigateTarget'>,
  maxBytes = MAX_PUSH_PAYLOAD_BYTES,
): PushPayload {
  const url = samePagePath(msg.navigateTarget);
  const base: PushPayload = {
    title: truncateChars(msg.title, TITLE_MAX_CHARS),
    body: '',
    ...(url ? { url } : {}),
    ...(url && msg.event === COLLAPSING_EVENT ? { tag: `${COLLAPSING_EVENT}:${url}` } : {}),
    // The Android app files it under a channel by event; a browser ignores it.
    ...(msg.event ? { event: msg.event } : {}),
  };
  const full = { ...base, body: msg.body };
  if (payloadBytes(full) <= maxBytes) return full;

  const chars = Array.from(msg.body);
  let fits = 0;
  let tooLong = chars.length;
  // Largest prefix that still fits with the ellipsis behind it.
  while (tooLong - fits > 1) {
    const mid = Math.floor((fits + tooLong) / 2);
    if (payloadBytes({ ...base, body: `${chars.slice(0, mid).join('')}${ELLIPSIS}` }) <= maxBytes) fits = mid;
    else tooLong = mid;
  }
  return { ...base, body: `${chars.slice(0, fits).join('')}${ELLIPSIS}` };
}

export const MAX_WEB_PUSH_DEVICES = 10;

interface DeviceContext {
  scope: WebPushDeviceScope;
  keys: ResolvedVapidKeys;
}

type DeliveryOutcome = 'sent' | 'failed' | 'invalid';

export class WebPushServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'WEB_PUSH_DISABLED'
      | 'WEB_PUSH_ORIGIN_UNAVAILABLE'
      | 'VAPID_CONFIG_INVALID'
      | 'WEB_PUSH_DEVICE_LIMIT'
      | 'WEB_PUSH_SUBSCRIPTION_INVALID',
  ) {
    super(message);
    this.name = 'WebPushServiceError';
  }
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const toIso = (value: string): string => {
  const iso = value.replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`).toISOString();
};

function device(row: WebPushDeviceRow): WebPushDevice {
  return {
    id: row.id,
    installationId: row.installation_id,
    label: row.label,
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    lastSuccessAt: row.last_success_at ? toIso(row.last_success_at) : null,
  };
}

@Injectable()
export class WebPushService {
  constructor(
    private readonly keys: VapidKeysService,
    private readonly prefs: NotificationPreferencesService,
    private readonly audit: AuditService,
    private readonly uow: UnitOfWork,
    @InjectRepository(WebPushSubscriptions) private readonly subscriptions: WebPushSubscriptionsRepository,
    @InjectRepository(Notifications) private readonly notifications: NotificationsRepository,
  ) {}

  private canonicalOrigin(): string {
    const { appUrl, isProduction } = readEnv().app;
    if (!appUrl?.trim()) {
      throw new WebPushServiceError('APP_URL is required for Web Push', 'WEB_PUSH_ORIGIN_UNAVAILABLE');
    }
    let url: URL;
    try {
      url = new URL(appUrl.trim());
    } catch {
      throw new WebPushServiceError('APP_URL must be a valid URL', 'WEB_PUSH_ORIGIN_UNAVAILABLE');
    }
    const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && (isProduction || !localhost || url.protocol !== 'http:')) {
      throw new WebPushServiceError('APP_URL must use HTTPS for Web Push', 'WEB_PUSH_ORIGIN_UNAVAILABLE');
    }
    return url.origin;
  }

  private async enabled(): Promise<boolean> {
    return (await this.prefs.getActiveChannels()).includes(WEB_PUSH_CHANNEL_ID);
  }

  private async context(userId: number): Promise<DeviceContext> {
    const origin = this.canonicalOrigin();
    let keys: ResolvedVapidKeys;
    try {
      keys = await this.keys.getKeys();
    } catch (error) {
      if (error instanceof PushUnavailableError) {
        throw new WebPushServiceError(error.message, 'VAPID_CONFIG_INVALID');
      }
      throw error;
    }
    return { keys, scope: { userId, origin, fingerprint: sha256(keys.publicKey) } };
  }

  async config(): Promise<WebPushConfigResult> {
    const enabled = await this.enabled();
    try {
      const canonicalOrigin = this.canonicalOrigin();
      return {
        enabled,
        available: true,
        maxDevices: MAX_WEB_PUSH_DEVICES,
        canonicalOrigin,
        publicKey: await this.keys.getPublicKey(),
      };
    } catch (error) {
      return {
        enabled,
        available: false,
        maxDevices: MAX_WEB_PUSH_DEVICES,
        error:
          error instanceof WebPushServiceError || error instanceof PushUnavailableError
            ? error.message
            : 'Web Push is unavailable',
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      this.canonicalOrigin();
      return await this.keys.isAvailable();
    } catch (error) {
      if (error instanceof WebPushServiceError) return false;
      throw error;
    }
  }

  async hasDevices(userId: number): Promise<boolean> {
    try {
      const origin = this.canonicalOrigin();
      const publicKey = await this.keys.peekPublicKey();
      return !!publicKey && (await this.subscriptions.hasEligible({ userId, origin, fingerprint: sha256(publicKey) }));
    } catch (error) {
      if (error instanceof WebPushServiceError || error instanceof PushUnavailableError) return false;
      throw error;
    }
  }

  async listDevices(userId: number): Promise<WebPushDevice[]> {
    const { scope } = await this.context(userId);
    return (await this.subscriptions.listEligible(scope)).map(device);
  }

  async registerCurrent(userId: number, input: WebPushCurrentRequest): Promise<WebPushCurrentResult> {
    if (!(await this.enabled())) {
      throw new WebPushServiceError('Web Push is disabled by the administrator', 'WEB_PUSH_DISABLED');
    }
    const { scope } = await this.context(userId);
    const checked = checkPushSubscription(input.subscription);
    if ('error' in checked) throw new WebPushServiceError(checked.error, 'WEB_PUSH_SUBSCRIPTION_INVALID');
    const hash = sha256(input.subscription.endpoint);

    const row = await this.uow.transactional(async () => {
      await this.subscriptions.markOriginMismatches(userId, scope.origin);
      const existing = await this.subscriptions.findInstallation(userId, input.installationId);
      if (input.intent === 'reconcile' && existing?.status !== 'active') return undefined;
      await this.subscriptions.revokeEndpointConflict(hash, userId, input.installationId);
      const alreadyEligible = existing?.status === 'active' && existing.vapid_key_fingerprint === scope.fingerprint;
      if (!alreadyEligible && (await this.subscriptions.countEligible(scope)) >= MAX_WEB_PUSH_DEVICES) {
        throw new WebPushServiceError(
          `A TREK account may register at most ${MAX_WEB_PUSH_DEVICES} Web Push devices`,
          'WEB_PUSH_DEVICE_LIMIT',
        );
      }
      return this.subscriptions.upsertDevice({
        user_id: userId,
        installation_id: input.installationId,
        endpoint_hash: hash,
        subscription_encrypted: encrypt_api_key(JSON.stringify(input.subscription)),
        origin: scope.origin,
        vapid_key_fingerprint: scope.fingerprint,
        label: existing?.label ?? input.label,
      });
    });
    if (!row) return { state: 'revoked' };
    if (input.intent === 'enable') {
      await this.audit.writeAudit({
        userId,
        action: 'web_push.device_enable',
        resource: String(row.id),
        details: { label: row.label },
      });
    }
    return { state: 'active', device: device(row) };
  }

  async renameDevice(userId: number, id: number, label: string): Promise<WebPushDevice | null> {
    const row = await this.subscriptions.renameDevice(userId, id, label);
    if (!row) return null;
    await this.audit.writeAudit({ userId, action: 'web_push.device_rename', resource: String(id), details: { label } });
    return device(row);
  }

  async revokeDevice(userId: number, id: number): Promise<boolean> {
    if (!(await this.subscriptions.revokeDevice(userId, id))) return false;
    await this.audit.writeAudit({ userId, action: 'web_push.device_revoke', resource: String(id) });
    return true;
  }

  private async payload(userId: number, message: ChannelMessage): Promise<Buffer> {
    const unreadCount = await this.notifications.countUnreadForRecipient(userId);
    const { url, ...content } = buildPushPayload(message, MAX_PUSH_PAYLOAD_BYTES - 200);
    return Buffer.from(JSON.stringify({ v: 1, recipientUserId: userId, ...content, path: url ?? '/', unreadCount }));
  }

  private async sendOne(
    row: WebPushDeviceRow,
    payload: Buffer,
    sign: VapidSigner,
    urgency: Urgency,
    options: DeliveryOptions = {},
  ): Promise<DeliveryOutcome> {
    if (!is_encrypted_api_key(row.subscription_encrypted)) return 'invalid';
    let clear: unknown;
    try {
      clear = JSON.parse(decrypt_api_key(row.subscription_encrypted) ?? 'null');
    } catch {
      return 'invalid';
    }
    const subscription = webPushSubscriptionSchema.safeParse(clear);
    if (!subscription.success) return 'invalid';
    const checked = checkPushSubscription(subscription.data);
    if (!checked.ok) return 'invalid';
    const { endpoint, p256dh, auth } = checked.value;
    try {
      const body = encryptPushMessage(payload, { p256dh, auth });
      const response = await safeFetchFollow(
        endpoint,
        {
          method: 'POST',
          headers: {
            TTL: String(options.ttlSeconds ?? PUSH_TTL_SECONDS),
            Urgency: urgency,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            Authorization: sign(endpoint),
            ...(options.background ? { [BACKGROUND_PUSH_HEADER]: 'background', Topic: WATCH_SYNC_TOPIC } : {}),
          },
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
        },
        { maxRedirects: 0, bypassInternalIpAllowed: true },
      );
      discardBody(response);
      if (response.ok) return 'sent';
      if (response.status === 404 || response.status === 410) return 'invalid';
      logError(`Web Push delivery failed device=${row.id} status=${response.status}`);
    } catch {
      logError(`Web Push delivery failed device=${row.id}`);
    }
    return 'failed';
  }

  /** @txIndependent Each device's outcome follows its own network request. */
  private async deliver(context: DeviceContext, rows: WebPushDeviceRow[], message: ChannelMessage) {
    const counts = { sent: 0, failed: 0, invalid: 0 };
    if (rows.length === 0) return counts;
    const sign = createVapidSigner(context.keys, this.keys.getSubject());
    const payload = await this.payload(context.scope.userId, message);
    const urgency = HIGH_URGENCY_EVENTS.has(message.event) ? 'high' : 'normal';
    await Promise.all(
      rows.map(async (row) => {
        const outcome = await this.sendOne(row, payload, sign, urgency);
        await this.subscriptions.recordDelivery(row, outcome);
        counts[outcome]++;
      }),
    );
    return counts;
  }

  private async testMessage(userId: number, deviceId?: number): Promise<ChannelTestResult> {
    if (!(await this.enabled())) return { success: false, error: 'Web Push is disabled by the administrator' };
    const context = await this.context(userId);
    const rows = await this.subscriptions.listEligible(context.scope);
    const selected = deviceId === undefined ? rows : rows.filter((row) => row.id === deviceId);
    if (deviceId !== undefined && selected.length === 0) return { success: false, error: 'Not found' };
    const result = await this.deliver(context, selected, {
      event: 'plugin_notification',
      title: 'TREK Web Push test',
      body: 'This device is ready to receive TREK notifications.',
      navigateTarget: '/settings',
    });
    return result.sent > 0 ? { success: true } : { success: false, error: 'Web Push test failed' };
  }

  /** @txIndependent The audit record reports the completed delivery. */
  async testDevice(userId: number, deviceId: number): Promise<ChannelTestResult> {
    const result = await this.testMessage(userId, deviceId);
    await this.audit.writeAudit({
      userId,
      action: 'web_push.device_test',
      resource: String(deviceId),
      details: { success: result.success },
    });
    return result;
  }

  async sendTest(userId: number): Promise<ChannelTestResult> {
    try {
      return await this.testMessage(userId);
    } catch (error) {
      if (error instanceof WebPushServiceError) return { success: false, error: error.message };
      throw error;
    }
  }

  /** @txIndependent Each encrypted device records its own delivery outcome. */
  async sendWatchSync(userId: number): Promise<boolean> {
    try {
      if (!(await this.enabled())) return false;
      const context = await this.context(userId);
      await this.subscriptions.markOriginMismatches(userId, context.scope.origin);
      const rows = await this.subscriptions.listEligible(context.scope);
      const sign = createVapidSigner(context.keys, this.keys.getSubject());
      const options: DeliveryOptions = { ttlSeconds: WATCH_SYNC_TTL_SECONDS, background: true };
      const outcomes = await Promise.all(
        rows.map(async (row) => {
          let subscription: unknown;
          if (!is_encrypted_api_key(row.subscription_encrypted)) return false;
          try {
            subscription = JSON.parse(decrypt_api_key(row.subscription_encrypted) ?? 'null');
          } catch {
            return false;
          }
          const parsed = webPushSubscriptionSchema.safeParse(subscription);
          if (!parsed.success || !isAppleRelayEndpoint(parsed.data.endpoint)) return false;
          const outcome = await this.sendOne(row, WATCH_SYNC_PAYLOAD, sign, 'low', options);
          await this.subscriptions.recordDelivery(row, outcome);
          return outcome === 'sent';
        }),
      );
      return outcomes.includes(true);
    } catch {
      logError(`Web Push dispatch failed user=${userId} event=watch_sync`);
      return false;
    }
  }

  /** @txIndependent Marking a stale origin is independent of sending to the active origin. */
  async sendToUser(userId: number, message: ChannelMessage) {
    const empty = { sent: 0, failed: 0, invalid: 0 };
    try {
      if (!(await this.enabled())) return empty;
      const context = await this.context(userId);
      await this.subscriptions.markOriginMismatches(userId, context.scope.origin);
      const rows = await this.subscriptions.listEligible(context.scope);
      return await this.deliver(context, rows, message);
    } catch {
      logError(`Web Push dispatch failed user=${userId} event=${message.event}`);
      return empty;
    }
  }
}
