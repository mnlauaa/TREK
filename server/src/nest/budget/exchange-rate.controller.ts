import type { User } from '../../types';
import { AuditService } from '../audit/audit.service';
import { getClientIp } from '../audit/client-ip';
import { CurrentUser } from '../auth-core/current-user.decorator';
import { JwtAuthGuard } from '../auth-core/jwt-auth.guard';
import { Public } from '../auth-core/public.decorator';
import { ResponseContract } from '../common/response-contract';
import { RequirePermission, TripAccessGuard } from '../permissions/trip-access.guard';
import { ApplyTripExchangeRateDto, PreviewTripExchangeRateDto, SetTripExchangeRateDto } from './budget.dto';
import { BudgetService } from './budget.service';
import { ExchangeRatesService, isSupportedProviderCurrency } from './exchange-rates.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  exchangeRateBatchApplyResultSchema,
  exchangeRateBatchPreviewSchema,
  exchangeRateResolutionSchema,
  exchangeRateSnapshotSchema,
  tripExchangeRateSchema,
} from '@trek/shared';

import type { Request } from 'express';
import { z } from 'zod';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_BUCKETS_MAX = 10_000;
const rateBuckets = new Map<string, { count: number; expiresAt: number }>();

function consumeRateLimit(ip: string, now = Date.now()): boolean {
  for (const [key, bucket] of rateBuckets) if (bucket.expiresAt <= now) rateBuckets.delete(key);
  let bucket = rateBuckets.get(ip);
  if (!bucket) {
    if (rateBuckets.size >= RATE_LIMIT_BUCKETS_MAX) rateBuckets.delete(rateBuckets.keys().next().value as string);
    bucket = { count: 0, expiresAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

export function resetPublicExchangeRateLimitForTests(): void {
  rateBuckets.clear();
}

@Controller('api/exchange-rates')
@Public('read-only public currency data used by the login/dashboard currency widget')
export class GlobalExchangeRateController {
  constructor(private readonly exchangeRates: ExchangeRatesService) {}

  @Get()
  @ResponseContract(exchangeRateSnapshotSchema)
  async get(@Query('base') base: string | undefined, @Req() req: Request) {
    const normalizedBase = (typeof base === 'string' ? base : 'EUR').trim().toUpperCase();
    if (!isSupportedProviderCurrency(normalizedBase)) {
      throw new HttpException({ error: 'Unsupported exchange-rate base currency' }, 400);
    }
    if (!consumeRateLimit(getClientIp(req) || 'unknown')) {
      throw new HttpException({ error: 'Too many exchange-rate requests' }, 429);
    }
    const snapshot = await this.exchangeRates.getGlobalRateSnapshot(normalizedBase);
    if (!snapshot) throw new HttpException({ error: 'No exchange-rate snapshot is available' }, 503);
    return snapshot;
  }
}

@Controller('api/trips/:tripId/exchange-rates')
@UseGuards(JwtAuthGuard, TripAccessGuard)
export class TripExchangeRateController {
  constructor(
    private readonly budget: BudgetService,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ResponseContract(z.object({ rates: z.array(tripExchangeRateSchema) }))
  async list(@Param('tripId') tripId: string) {
    return { rates: await this.exchangeRates.listTripExchangeRates(tripId) };
  }

  @Get('resolve')
  @ResponseContract(exchangeRateResolutionSchema)
  async resolve(@Param('tripId') tripId: string, @Query('currency') currency?: string) {
    if (typeof currency !== 'string' || !currency.trim())
      throw new HttpException({ error: 'currency is required' }, 400);
    const resolution = await this.exchangeRates.resolveExchangeRate(tripId, currency);
    if (!resolution) throw new HttpException({ error: 'No exchange rate is available; enter a manual rate' }, 404);
    return resolution;
  }

  @RequirePermission('budget_edit')
  @Put(':currency')
  @ResponseContract(z.object({ rate: tripExchangeRateSchema }))
  async set(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('currency') currency: string,
    @Body() body: SetTripExchangeRateDto,
    @Headers('x-socket-id') socketId: string | undefined,
    @Req() req: Request,
  ) {
    const rate = await this.exchangeRates.setTripExchangeRate(tripId, currency, body.exchange_rate, user.id, body.note);
    this.budget.broadcast(tripId, 'budget:exchange-rates-updated', { rate }, socketId);
    await this.audit.writeAudit({
      userId: user.id,
      action: 'budget.exchange_rate_set',
      resource: tripId,
      ip: getClientIp(req),
      details: { tripId: Number(tripId), currency: currency.toUpperCase(), exchange_rate: body.exchange_rate },
    });
    return { rate };
  }

  @RequirePermission('budget_edit')
  @Delete(':currency')
  @ResponseContract(z.object({ success: z.literal(true) }))
  async remove(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('currency') currency: string,
    @Headers('x-socket-id') socketId: string | undefined,
    @Req() req: Request,
  ) {
    const deleted = await this.exchangeRates.deleteTripExchangeRate(tripId, currency);
    if (!deleted) throw new HttpException({ error: 'Trip exchange rate not found' }, 404);
    this.budget.broadcast(
      tripId,
      'budget:exchange-rates-updated',
      { currency: currency.toUpperCase(), deleted: true },
      socketId,
    );
    await this.audit.writeAudit({
      userId: user.id,
      action: 'budget.exchange_rate_delete',
      resource: tripId,
      ip: getClientIp(req),
      details: { tripId: Number(tripId), currency: currency.toUpperCase() },
    });
    return { success: true };
  }

  @RequirePermission('budget_edit')
  @Post(':currency/preview')
  @ResponseContract(exchangeRateBatchPreviewSchema)
  async preview(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('currency') currency: string,
    @Body() body: PreviewTripExchangeRateDto,
  ) {
    return await this.exchangeRates.previewTripExchangeRateUpdate(
      tripId,
      currency,
      body.exchange_rate,
      user.id,
      body.note,
    );
  }

  @RequirePermission('budget_edit')
  @Post(':currency/apply')
  @ResponseContract(exchangeRateBatchApplyResultSchema)
  async apply(
    @CurrentUser() user: User,
    @Param('tripId') tripId: string,
    @Param('currency') currency: string,
    @Body() body: ApplyTripExchangeRateDto,
    @Headers('x-socket-id') socketId: string | undefined,
    @Req() req: Request,
  ) {
    const result = await this.exchangeRates.applyTripExchangeRateUpdate(
      tripId,
      body.preview_id,
      body.selected,
      user.id,
      currency,
    );
    this.budget.broadcast(tripId, 'budget:exchange-rates-applied', result, socketId);
    await this.audit.writeAudit({
      userId: user.id,
      action: 'budget.exchange_rate_apply',
      resource: tripId,
      ip: getClientIp(req),
      details: { tripId: Number(tripId), currency: currency.toUpperCase(), updated: body.selected.length },
    });
    return result;
  }
}
