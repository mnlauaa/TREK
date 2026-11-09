import { Migration } from '@mikro-orm/migrations';
import type { SqliteConnection } from '@mikro-orm/sqlite';

export class Migration20200101046370_retire_fork_web_push extends Migration {
  override async up(): Promise<void> {
    const db = await (this.driver.getConnection() as SqliteConnection).getNativeClient();
    if (!db.inTransaction) throw new Error('Push retirement requires a transaction');
    db.exec(`
      INSERT INTO notification_channel_preferences (user_id, event_type, channel, enabled)
        SELECT user_id, event_type, 'push', enabled
        FROM notification_channel_preferences WHERE channel = 'webpush'
        ON CONFLICT(user_id, event_type, channel) DO UPDATE SET enabled = excluded.enabled;
      DELETE FROM notification_channel_preferences WHERE channel = 'webpush';
      DELETE FROM push_subscriptions;
    `);
    const defaults = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string | null }[];
    const save = db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    for (const { key, value } of defaults) {
      if (!key.startsWith('notif_default_') || !key.endsWith('_webpush')) continue;
      save.run(`${key.slice(0, -7)}push`, value);
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    }
    for (const key of ['notification_channels', 'notification_channel']) {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
        { value: string | null } | undefined;
      if (typeof row?.value !== 'string') continue;
      const channels = [
        ...new Set(
          row.value
            .split(',')
            .map((id) => (id.trim() === 'webpush' ? 'push' : id.trim()))
            .filter(Boolean),
        ),
      ];
      save.run(key, channels.join(',') || 'none');
    }
  }
}
