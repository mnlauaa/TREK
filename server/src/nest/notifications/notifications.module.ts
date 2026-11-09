import { AppSettings } from '../../db/entities/AppSettings.entity';
import { NotificationChannelPreferences } from '../../db/entities/NotificationChannelPreferences.entity';
import { Notifications } from '../../db/entities/Notifications.entity';
import { Settings } from '../../db/entities/Settings.entity';
import { TodoItems } from '../../db/entities/TodoItems.entity';
import { Trips } from '../../db/entities/Trips.entity';
import { WebPushSubscriptions } from '../../db/entities/WebPushSubscriptions.entity';
import { AddonsModule } from '../addons/addons.module';
import { AuditModule } from '../audit/audit.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { StorageModule } from '../storage/storage.module';
import { TripMembershipModule } from '../trip-membership/trip-membership.module';
import { MailerModule } from './mailer/mailer.module';
import { NotificationPreferencesService } from './notification-preferences.service';
import { AdminNotificationPreferencesController, NotificationsController } from './notifications.controller';
import { NotificationsMcp } from './notifications.mcp';
import { NotificationsService } from './notifications.service';
import { PushController } from './push/push.controller';
import { VapidKeysService } from './push/vapid-keys.service';
import { WatchSyncPushService } from './push/watch-sync-push.service';
import { ReminderJobsService } from './reminder-jobs.service';
import { StorageHealthNotifierService } from './storage-health-notifier.service';
import { NtfyService } from './transports/ntfy.service';
import { WebPushService } from './transports/web-push.service';
import { WebhookService } from './transports/webhook.service';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    MikroOrmModule.forFeature([
      Notifications,
      NotificationChannelPreferences,
      AppSettings,
      Settings,
      Trips,
      TodoItems,
      WebPushSubscriptions,
    ]),

    AuditModule,
    AddonsModule,
    MailerModule,
    SchedulingModule,
    StorageModule,
    TripMembershipModule,
  ],
  controllers: [NotificationsController, AdminNotificationPreferencesController, PushController],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    WebhookService,
    NtfyService,
    WebPushService,
    VapidKeysService,
    WatchSyncPushService,
    NotificationsMcp,
    ReminderJobsService,
    StorageHealthNotifierService,
  ],
  exports: [NotificationsService, NotificationPreferencesService],
})
export class NotificationsModule {}
