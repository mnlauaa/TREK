import type { User } from '../../../types';
import { CurrentUser } from '../../auth-core/current-user.decorator';
import { JwtAuthGuard } from '../../auth-core/jwt-auth.guard';
import { ResponseContract } from '../../common/response-contract';
import { toRowId } from '../../common/row-id';
import { WebPushCurrentDto, WebPushRenameDto } from '../notifications.dto';
import { WebPushService, WebPushServiceError } from '../transports/web-push.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  channelTestResultSchema,
  successResponseSchema,
  webPushConfigResultSchema,
  webPushCurrentResultSchema,
  webPushDeviceListResultSchema,
} from '@trek/shared';

@Controller('api/notifications/web-push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: WebPushService) {}

  @Get('config')
  @ResponseContract(webPushConfigResultSchema)
  config() {
    return this.push.config();
  }

  @Get('devices')
  @ResponseContract(webPushDeviceListResultSchema)
  async devices(@CurrentUser() user: User) {
    try {
      return { devices: await this.push.listDevices(user.id) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @Put('current')
  @ResponseContract(webPushCurrentResultSchema)
  async current(@CurrentUser() user: User, @Body() body: WebPushCurrentDto) {
    try {
      return await this.push.registerCurrent(user.id, body);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Patch('devices/:id')
  @ResponseContract(webPushCurrentResultSchema.pick({ device: true }).required())
  async rename(@CurrentUser() user: User, @Param('id') id: string, @Body() body: WebPushRenameDto) {
    const device = await this.push.renameDevice(user.id, this.deviceId(id), body.label);
    if (!device) throw new HttpException({ error: 'Not found' }, 404);
    return { device };
  }

  @Delete('devices/:id')
  @ResponseContract(successResponseSchema)
  async revoke(@CurrentUser() user: User, @Param('id') id: string) {
    if (!(await this.push.revokeDevice(user.id, this.deviceId(id)))) {
      throw new HttpException({ error: 'Not found' }, 404);
    }
    return { success: true };
  }

  @Post('devices/:id/test')
  @HttpCode(200)
  @ResponseContract(channelTestResultSchema)
  async test(@CurrentUser() user: User, @Param('id') id: string) {
    try {
      return await this.push.testDevice(user.id, this.deviceId(id));
    } catch (error) {
      this.mapError(error);
    }
  }

  private deviceId(value: string): number {
    const id = toRowId(value);
    if (id === null || id <= 0) throw new HttpException({ error: 'Invalid id' }, 400);
    return id;
  }

  private mapError(error: unknown): never {
    if (!(error instanceof WebPushServiceError)) throw error;
    const status = {
      WEB_PUSH_DISABLED: 409,
      WEB_PUSH_DEVICE_LIMIT: 409,
      WEB_PUSH_SUBSCRIPTION_INVALID: 400,
      WEB_PUSH_ORIGIN_UNAVAILABLE: 503,
      VAPID_CONFIG_INVALID: 503,
    }[error.code];
    throw new HttpException({ error: error.message, code: error.code }, status);
  }
}
