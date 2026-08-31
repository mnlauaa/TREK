import {
  GlobalExchangeRateController,
  resetPublicExchangeRateLimitForTests,
  TripExchangeRateController,
} from '../../../src/nest/budget/exchange-rate.controller';
import {
  ExchangeRatePreviewExpiredError,
  InvalidExchangeRateError,
} from '../../../src/nest/budget/exchange-rates.service';
import { HttpException } from '@nestjs/common';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = (ip = '203.0.113.7') => ({ ip, headers: {} }) as Request;

describe('GlobalExchangeRateController', () => {
  beforeEach(() => resetPublicExchangeRateLimitForTests());

  it('normalizes a supported base and returns the durable snapshot', async () => {
    const getGlobalRateSnapshot = vi.fn(async () => ({ base_currency: 'USD', rates: { USD: 1, EUR: 0.8 } }));
    const controller = new GlobalExchangeRateController({ getGlobalRateSnapshot } as never);
    await expect(controller.get(' usd ', request())).resolves.toMatchObject({ base_currency: 'USD' });
    expect(getGlobalRateSnapshot).toHaveBeenCalledWith('USD');
  });

  it('maps unsupported, unavailable, and rate-limited requests to their public status', async () => {
    const getGlobalRateSnapshot = vi.fn(async () => null);
    const controller = new GlobalExchangeRateController({ getGlobalRateSnapshot } as never);
    await expect(controller.get('XYZ', request())).rejects.toMatchObject({ status: 400 });
    await expect(controller.get(undefined, request())).rejects.toMatchObject({ status: 503 });

    getGlobalRateSnapshot.mockResolvedValue({ base_currency: 'EUR', rates: { EUR: 1, USD: 1.2 } });
    resetPublicExchangeRateLimitForTests();
    for (let index = 0; index < 60; index += 1) await controller.get('EUR', request('198.51.100.9'));
    await expect(controller.get('EUR', request('198.51.100.9'))).rejects.toMatchObject({ status: 429 });
  });
});

describe('TripExchangeRateController', () => {
  const user = { id: 7 };
  const req = request();
  let budget: { broadcast: ReturnType<typeof vi.fn> };
  let rates: Record<string, ReturnType<typeof vi.fn>>;
  let audit: { writeAudit: ReturnType<typeof vi.fn> };
  let controller: TripExchangeRateController;

  beforeEach(() => {
    budget = { broadcast: vi.fn() };
    rates = {
      listTripExchangeRates: vi.fn(() => [{ currency: 'USD' }]),
      resolveExchangeRate: vi.fn(async () => ({ source: 'trip', exchange_rate: 1.2 })),
      setTripExchangeRate: vi.fn(() => ({ currency: 'USD', exchange_rate: 1.2 })),
      deleteTripExchangeRate: vi.fn(() => true),
      previewTripExchangeRateUpdate: vi.fn(async () => ({ preview_id: 'p1', rows: [] })),
      applyTripExchangeRateUpdate: vi.fn(() => ({ rate: { currency: 'USD' }, updated: [] })),
    };
    audit = { writeAudit: vi.fn() };
    controller = new TripExchangeRateController(budget as never, rates as never, audit as never);
  });

  it('lists rates and resolves a requested currency', async () => {
    expect(controller.list('4')).toEqual({ rates: [{ currency: 'USD' }] });
    await expect(controller.resolve('4', undefined)).rejects.toMatchObject({ status: 400 });
    await expect(controller.resolve('4', 'usd')).resolves.toMatchObject({ source: 'trip' });
    rates.resolveExchangeRate.mockResolvedValueOnce(null);
    await expect(controller.resolve('4', 'JPY')).rejects.toMatchObject({ status: 404 });
  });

  it('sets a Trip rate, broadcasts it, and writes a privacy-safe audit record', () => {
    expect(controller.set(user as never, '4', 'usd', { exchange_rate: 1.2, note: 'bank' }, 'socket', req)).toEqual({
      rate: { currency: 'USD', exchange_rate: 1.2 },
    });
    expect(rates.setTripExchangeRate).toHaveBeenCalledWith('4', 'usd', 1.2, 7, 'bank');
    expect(budget.broadcast).toHaveBeenCalledWith(
      '4',
      'budget:exchange-rates-updated',
      { rate: { currency: 'USD', exchange_rate: 1.2 } },
      'socket',
    );
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'budget.exchange_rate_set',
        details: expect.objectContaining({ currency: 'USD' }),
      }),
    );
  });

  it('deletes an existing Trip rate and preserves a real 404 for a missing one', () => {
    expect(controller.remove(user as never, '4', 'usd', undefined, req)).toEqual({ success: true });
    expect(budget.broadcast).toHaveBeenCalledWith(
      '4',
      'budget:exchange-rates-updated',
      { currency: 'USD', deleted: true },
      undefined,
    );
    rates.deleteTripExchangeRate.mockReturnValueOnce(false);
    expect(() => controller.remove(user as never, '4', 'USD', undefined, req)).toThrow(HttpException);
  });

  it('previews and applies a batch, including its audit and socket event', async () => {
    await expect(controller.preview(user as never, '4', 'USD', { exchange_rate: 1.3, note: null })).resolves.toEqual({
      preview_id: 'p1',
      rows: [],
    });
    const result = controller.apply(
      user as never,
      '4',
      'usd',
      { preview_id: 'p1', selected: [{ type: 'expense', id: 1 }] },
      'socket',
      req,
    );
    expect(result).toEqual({ rate: { currency: 'USD' }, updated: [] });
    expect(budget.broadcast).toHaveBeenCalledWith('4', 'budget:exchange-rates-applied', result, 'socket');
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'budget.exchange_rate_apply',
        details: expect.objectContaining({ updated: 1 }),
      }),
    );
  });

  it('maps domain errors, includes the expiry code, and rethrows unknown failures', async () => {
    rates.setTripExchangeRate.mockImplementationOnce(() => {
      throw new InvalidExchangeRateError('bad rate');
    });
    expect(() => controller.set(user as never, '4', 'USD', { exchange_rate: 0 }, undefined, req)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );

    rates.previewTripExchangeRateUpdate.mockRejectedValueOnce(
      new ExchangeRatePreviewExpiredError('Exchange-rate preview expired'),
    );
    try {
      await controller.preview(user as never, '4', 'USD', { exchange_rate: 1.2 });
      throw new Error('expected preview to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'EXCHANGE_RATE_PREVIEW_EXPIRED' });
    }

    const unknown = new Error('database unavailable');
    rates.applyTripExchangeRateUpdate.mockImplementationOnce(() => {
      throw unknown;
    });
    expect(() =>
      controller.apply(user as never, '4', 'USD', { preview_id: 'p', selected: [] }, undefined, req),
    ).toThrow(unknown);
  });
});
