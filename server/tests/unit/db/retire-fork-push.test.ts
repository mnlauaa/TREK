import { createMigrationOrm, migrateTo, migratorOf, rawExec, rawQuery } from '../../helpers/migration-step';

import { describe, expect, it } from 'vitest';

const before = 'Migration20200101046360_a_new_install_starts_with_more_addons_on';
const target = 'Migration20200101046370_retire_fork_web_push';

describe('retiring fork push in favour of upstream registration', () => {
  it('preserves current opt-outs and history, clears stale registrations only once', async () => {
    const orm = await createMigrationOrm();
    try {
      await migrateTo(orm, before);
      await rawExec(orm, "INSERT INTO users (id, username, email, password_hash) VALUES (1, 'u', 'u@test', 'x')");
      await rawExec(
        orm,
        `INSERT INTO notification_channel_preferences (user_id, event_type, channel, enabled) VALUES
        (1, 'trip_invite', 'push', 1), (1, 'trip_invite', 'webpush', 0), (1, 'chat_message', 'push', 0),
        (1, 'trip_update', 'webpush', 1), (1, 'trip_invite', 'inapp', 1)`,
      );
      const settings = [
        ['notif_default_trip_invite_push', '1'],
        ['notif_default_trip_invite_webpush', '0'],
        ['notif_default_chat_message_push', '0'],
        ['notification_channels', 'webhook,webpush,push,custom'],
        ['notification_channel', 'webpush'],
        ['web_push_vapid_public_key', 'keep-public'],
        ['web_push_vapid_private_key', 'keep-encrypted'],
      ];
      await rawExec(
        orm,
        `INSERT OR REPLACE INTO app_settings (key,value) VALUES ${settings.map(() => '(?,?)').join(',')}`,
        settings.flat(),
      );
      const registration = `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, vapid_public_key)
        VALUES (1, 'https://push.example/device', 'p', 'a', 'v')`;
      await rawExec(orm, registration);
      await rawExec(
        orm,
        `INSERT INTO web_push_subscriptions
        (user_id,installation_id,endpoint_hash,subscription_encrypted,origin,vapid_key_fingerprint,label,status)
        VALUES (1,'old','hash','encrypted','https://example.test','fingerprint','old device','revoked')`,
      );
      const ledger = await rawQuery(orm, 'SELECT * FROM fork_schema_migrations ORDER BY id');
      const legacy = await rawQuery(orm, 'SELECT * FROM web_push_subscriptions');
      await migrateTo(orm, target);
      expect(await rawQuery(orm, 'SELECT * FROM push_subscriptions')).toEqual([]);
      expect(
        await rawQuery(
          orm,
          "SELECT event_type,enabled FROM notification_channel_preferences WHERE channel='push' ORDER BY event_type",
        ),
      ).toEqual([
        { event_type: 'chat_message', enabled: 0 },
        { event_type: 'trip_invite', enabled: 0 },
        { event_type: 'trip_update', enabled: 1 },
      ]);
      expect(await rawQuery(orm, "SELECT * FROM notification_channel_preferences WHERE channel='webpush'")).toEqual([]);
      expect(await rawQuery(orm, "SELECT value FROM app_settings WHERE key='notif_default_trip_invite_push'")).toEqual([
        { value: '0' },
      ]);
      expect(await rawQuery(orm, "SELECT value FROM app_settings WHERE key='notification_channels'")).toEqual([
        { value: 'webhook,push,custom' },
      ]);
      expect(await rawQuery(orm, "SELECT value FROM app_settings WHERE key='notification_channel'")).toEqual([
        { value: 'push' },
      ]);
      expect(await rawQuery(orm, "SELECT value FROM app_settings WHERE key='web_push_vapid_private_key'")).toEqual([
        { value: 'keep-encrypted' },
      ]);
      expect(await rawQuery(orm, 'SELECT * FROM fork_schema_migrations ORDER BY id')).toEqual(ledger);
      expect(await rawQuery(orm, 'SELECT * FROM web_push_subscriptions')).toEqual(legacy);
      await rawExec(orm, registration);
      await migratorOf(orm).up();
      expect(await rawQuery(orm, 'SELECT * FROM push_subscriptions')).toHaveLength(1);
      expect(await rawQuery(orm, 'PRAGMA foreign_key_check')).toEqual([]);
    } finally {
      await orm.close(true);
    }
  });

  it('keeps nullable unset channel settings valid during upgrade', async () => {
    const orm = await createMigrationOrm();
    try {
      await migrateTo(orm, before);
      await rawExec(
        orm,
        `INSERT OR REPLACE INTO app_settings (key,value) VALUES
        ('notification_channels',NULL), ('notification_channel',NULL), ('notif_default_trip_invite_webpush',NULL)`,
      );
      await migrateTo(orm, target);
      expect(
        await rawQuery(
          orm,
          "SELECT key,value FROM app_settings WHERE key IN ('notification_channels','notification_channel','notif_default_trip_invite_push') ORDER BY key",
        ),
      ).toEqual([
        { key: 'notif_default_trip_invite_push', value: null },
        { key: 'notification_channel', value: null },
        { key: 'notification_channels', value: null },
      ]);
    } finally {
      await orm.close(true);
    }
  });
});
