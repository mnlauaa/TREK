/**
 * Unit tests for the DI-native ExchangeRatesService — FX-SVC-001 through
 * FX-SVC-022. New suite: the legacy services/exchangeRateService.ts had no
 * dedicated tests; the budget-domain fold moved it inside the src/nest/**
 * coverage gate. 001–012 pin the fetch/cache behavior (including the parity
 * quirks kept on purpose: `|| 'EUR'` falsy coercion, stale-cache fallback, the
 * `>1 keys` failure heuristic); 019 pins the module-scoped cache shared across
 * instances (the DI singleton and the out-of-container bridge instances wrap
 * one feed — originally pinned via the exchange-rates.bridge, deleted with the
 * budget fold); 021–022 pin the post-fold quirk fixes (AbortSignal timeout,
 * response-size cap, logged failures). 013–018 and 020 covered the dead
 * convertWithRates export and were removed with it in the quirk fixes.
 *
 * The rate cache is deliberately MODULE-scoped, so it persists across tests in
 * this file — every case uses its own base currency to stay isolated.
 */
import {
  convertWithRates,
  effectiveTripValue,
  type ExchangeRateWrite,
  ExchangeRateConflictError,
  ExchangeRatePreviewExpiredError,
  ExchangeRatesService,
  InvalidExchangeRateError,
  isSupportedProviderCurrency,
  resetExchangeRateProviderStateForTests,
} from '../../../src/nest/budget/exchange-rates.service';
import { DatabaseService } from '../../../src/nest/database/database.service';
import { createTestDb } from '../../helpers/test-db';

import type Database from 'better-sqlite3';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TTL_MS = 6 * 60 * 60 * 1000; // mirrors the service's 6h TTL

// A minimal Frankfurter-shaped success response (array of { quote, rate }).
const okResponse = (data: unknown) => ({ ok: true, text: async () => JSON.stringify(data) });

const snapshots = new Map<
  string,
  {
    base_currency: string;
    rates_json: string;
    source_version: string;
    effective_date: string | null;
    fetched_at: string;
  }
>();
const fakeDb = {
  get(sql: string, base: string) {
    if (sql.includes('global_exchange_rate_snapshots')) return snapshots.get(base);
    return undefined;
  },
  run(sql: string, ...args: unknown[]) {
    if (sql.includes('INSERT INTO global_exchange_rate_snapshots')) {
      const [base_currency, rates_json, source_version, effective_date, fetched_at] = args as [
        string,
        string,
        string,
        string | null,
        string,
      ];
      snapshots.set(base_currency, { base_currency, rates_json, source_version, effective_date, fetched_at });
    }
    return { changes: 1 };
  },
  all() {
    return [];
  },
} as unknown as DatabaseService;
const svc = new ExchangeRatesService(fakeDb);

let fetchMock: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => okResponse([{ quote: 'USD', rate: 1.08 }]));
  vi.stubGlobal('fetch', fetchMock);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  errorSpy.mockRestore();
});

describe('ExchangeRatesService.getRates', () => {
  it('FX-SVC-001: falls back to EUR for a falsy base (|| coercion, not ??)', async () => {
    const rates = await svc.getRates('');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.frankfurter.dev/v2/rates?base=EUR');
    expect(rates).toEqual({ EUR: 1, USD: 1.08 });
  });

  it('FX-SVC-002: upper-cases the base for the request and the self-rate seed', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ quote: 'GBP', rate: 0.85 }]));
    const rates = await svc.getRates('usd');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.frankfurter.dev/v2/rates?base=USD');
    expect(rates).toEqual({ USD: 1, GBP: 0.85 });
  });

  it('FX-SVC-003: seeds base = 1, indexes by quote and skips malformed entries', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse([
        { quote: 'USD', rate: 1.08 },
        { quote: 'GBP', rate: 0.85 },
        { quote: 42, rate: 1 }, // non-string quote → skipped
        { quote: 'JPY' }, // missing rate → skipped
        null, // null entry → skipped
      ]),
    );
    const rates = await svc.getRates('CHF');
    expect(rates).toEqual({ CHF: 1, USD: 1.08, GBP: 0.85 });
  });

  it('FX-SVC-004: returns null on a non-ok upstream response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => [] });
    expect(await svc.getRates('NOK')).toBeNull();
  });

  it('FX-SVC-005: returns null when the response body is not an array', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ USD: 1.08 }));
    expect(await svc.getRates('SEK')).toBeNull();
  });

  it('FX-SVC-006: returns null when fetch throws — and logs the failure (quirk fix)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await svc.getRates('DKK')).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('[exchange-rates] rates fetch failed for', 'DKK', expect.any(Error));
  });

  it('FX-SVC-007: treats a response that yields only the self-rate as failure (>1 keys heuristic)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([]));
    expect(await svc.getRates('CZK')).toBeNull();
  });

  it('FX-SVC-008: serves the cached rates within the TTL without refetching', async () => {
    const first = await svc.getRates('PLN');
    const second = await svc.getRates('PLN');
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('FX-SVC-009: refetches once the TTL has elapsed', async () => {
    vi.useFakeTimers();
    await svc.getRates('HUF');
    vi.advanceTimersByTime(TTL_MS + 1);
    fetchMock.mockResolvedValueOnce(okResponse([{ quote: 'USD', rate: 1.2 }]));
    const rates = await svc.getRates('HUF');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rates).toEqual({ HUF: 1, USD: 1.2 });
  });

  it('FX-SVC-010: quirk — falls back to the stale cache (beyond the TTL) when the upstream fails', async () => {
    vi.useFakeTimers();
    const first = await svc.getRates('RON');
    vi.advanceTimersByTime(TTL_MS + 1);
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await svc.getRates('RON')).toEqual(first);
  });

  it('FX-SVC-011: coalesces concurrent fetches for the same base into one request', async () => {
    let release!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const a = svc.getRates('ISK');
    const b = svc.getRates('ISK');
    release(okResponse([{ quote: 'USD', rate: 1.08 }]));
    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rb).toBe(ra);
  });

  it('FX-SVC-012: returns null on failure when nothing is cached', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => [] });
    expect(await svc.getRates('BGN')).toBeNull();
  });

  it('FX-SVC-021: sends the request with an abort-timeout signal (quirk fix)', async () => {
    await svc.getRates('MXN');
    const opts = fetchMock.mock.calls[0][1] as { signal?: unknown } | undefined;
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });

  it('FX-SVC-022: treats an oversized response body as failure (quirk fix)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => 'x'.repeat(1024 * 1024 + 1) });
    expect(await svc.getRates('BRL')).toBeNull();
  });
});

describe('cross-instance cache sharing', () => {
  it('FX-SVC-019: a second instance (the out-of-container bridge shape) serves the module-scoped cache', async () => {
    // Prime the cache through the DI-style instance…
    const primed = await svc.getRates('AUD');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // …then a separately-constructed instance (as the trips/airtrail/auth
    // bridges new up) must serve the same cached feed instead of refetching.
    expect(await new ExchangeRatesService(fakeDb).getRates('AUD')).toEqual(primed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('enhanced frozen-rate workflow', () => {
  let db: Database.Database;
  let service: ExchangeRatesService;
  let ownerId: number;
  let memberId: number;
  let tripId: number;

  const saveSnapshot = (
    base: string,
    rates: Record<string, number>,
    fetchedAt = new Date().toISOString(),
    sourceVersion = 'fixture:v1',
  ) => {
    db.prepare(
      `INSERT OR REPLACE INTO global_exchange_rate_snapshots
         (base_currency, rates_json, source_version, effective_date, fetched_at)
       VALUES (?, ?, ?, '2026-08-30', ?)`,
    ).run(base, JSON.stringify(rates), sourceVersion, fetchedAt);
  };

  const expense = (rate = 1.25, source = 'global') =>
    Number(
      db
        .prepare(
          `INSERT INTO budget_items
             (trip_id, name, total_price, currency, exchange_rate, exchange_rate_source,
              exchange_rate_source_version, exchange_rate_set_at)
           VALUES (?, 'Hotel', 125, 'USD', ?, ?, 'fixture:old', CURRENT_TIMESTAMP)`,
        )
        .run(tripId, rate, source).lastInsertRowid,
    );

  const settlement = (rate = 1.25, source = 'trip') =>
    Number(
      db
        .prepare(
          `INSERT INTO budget_settlements
             (trip_id, from_user_id, to_user_id, amount, currency, exchange_rate,
              exchange_rate_source, exchange_rate_source_version, exchange_rate_set_at)
           VALUES (?, ?, ?, 50, 'USD', ?, ?, 'fixture:old', CURRENT_TIMESTAMP)`,
        )
        .run(tripId, ownerId, memberId, rate, source).lastInsertRowid,
    );

  beforeEach(() => {
    resetExchangeRateProviderStateForTests();
    db = createTestDb();
    const insertUser = db.prepare('INSERT INTO users (username,email,password_hash,role) VALUES (?, ?, ?, ?)');
    ownerId = Number(insertUser.run('owner', 'owner@fx.test', 'x', 'admin').lastInsertRowid);
    memberId = Number(insertUser.run('member', 'member@fx.test', 'x', 'user').lastInsertRowid);
    tripId = Number(
      db.prepare("INSERT INTO trips (user_id,title,currency) VALUES (?, 'FX trip', 'EUR')").run(ownerId)
        .lastInsertRowid,
    );
    db.prepare('INSERT INTO trip_members (trip_id,user_id) VALUES (?, ?)').run(tripId, memberId);
    service = new ExchangeRatesService(new DatabaseService(db));
  });

  afterEach(() => {
    resetExchangeRateProviderStateForTests();
    db.close();
  });

  it('covers supported currencies and frozen-value conversion rules', () => {
    expect(isSupportedProviderCurrency(' usd ')).toBe(true);
    expect(isSupportedProviderCurrency('ZZZ')).toBe(false);
    expect(convertWithRates(125, 'USD', 'EUR', { EUR: 1, USD: 1.25 })).toBe(100);
    expect(convertWithRates(125, 'EUR', 'EUR', null)).toBe(125);
    expect(convertWithRates(125, 'USD', 'EUR', { EUR: 1, USD: 0 })).toBe(125);
    expect(effectiveTripValue(125, 'USD', 'EUR', 1.25, 'trip', null)).toBe(100);
    expect(effectiveTripValue(125, 'USD', 'EUR', 1, 'legacy', { EUR: 1, USD: 1.25 })).toBe(100);
    expect(effectiveTripValue(125, 'EUR', 'EUR', 999, 'explicit', null)).toBe(125);
    expect(effectiveTripValue(125, 'USD', 'EUR', null, null, null)).toBe(125);
  });

  it('reads durable snapshots, rejects corrupt rows, and does not fetch unsupported bases', async () => {
    saveSnapshot('EUR', { EUR: 1, USD: 1.25 });
    const fresh = await service.getGlobalRateSnapshot('eur');
    expect(fresh).toMatchObject({ base_currency: 'EUR', rates: { EUR: 1, USD: 1.25 }, stale: false });
    expect(fetchMock).not.toHaveBeenCalled();

    saveSnapshot('ZZZ', { ZZZ: 1, USD: 2 });
    expect(await service.refreshGlobalRates('zzz')).toMatchObject({ base_currency: 'ZZZ' });
    expect(fetchMock).not.toHaveBeenCalled();

    db.prepare("UPDATE global_exchange_rate_snapshots SET rates_json = '{' WHERE base_currency = 'ZZZ'").run();
    expect(await service.refreshGlobalRates('ZZZ')).toBeNull();
  });

  it('refreshes every supported stored base once and always includes EUR', async () => {
    saveSnapshot('USD', { USD: 1, EUR: 0.8 });
    saveSnapshot('ZZZ', { ZZZ: 1, EUR: 2 });
    fetchMock.mockImplementation(async (url: string) => {
      const base = new URL(url).searchParams.get('base')!;
      return okResponse([{ date: '2026-08-30', quote: base === 'EUR' ? 'USD' : 'EUR', rate: 1.2 }]);
    });
    await service.refreshStoredRateBases();
    expect(fetchMock.mock.calls.map((call) => new URL(call[0]).searchParams.get('base')).sort()).toEqual([
      'EUR',
      'USD',
    ]);
  });

  it('resolves identity, Trip, Global, unavailable, missing-trip, and invalid currency paths', async () => {
    saveSnapshot('EUR', { EUR: 1, USD: 1.25 });
    expect(await service.resolveExchangeRate(tripId, 'EUR')).toMatchObject({ source: 'identity', exchange_rate: 1 });
    expect(await service.resolveExchangeRate(99999, 'USD')).toBeNull();
    await expect(service.resolveExchangeRate(tripId, 'bad-code')).rejects.toBeInstanceOf(InvalidExchangeRateError);

    db.prepare(
      `INSERT INTO trip_exchange_rates
         (trip_id,currency,exchange_rate,effective_date,source_version,set_at,set_by_user_id,note)
       VALUES (?, 'USD', 1.3, '2026-08-29', 'trip:fixture', CURRENT_TIMESTAMP, ?, 'saved')`,
    ).run(tripId, ownerId);
    expect(await service.resolveExchangeRate(tripId, 'usd')).toMatchObject({
      source: 'trip',
      exchange_rate: 1.3,
      source_version: 'trip:fixture',
    });

    db.prepare("DELETE FROM trip_exchange_rates WHERE trip_id = ? AND currency = 'USD'").run(tripId);
    expect(await service.resolveExchangeRate(tripId, 'USD')).toMatchObject({ source: 'global', exchange_rate: 1.25 });
    expect(await service.resolveExchangeRate(tripId, 'JPY')).toBeNull();
  });

  it('freezes identity and explicit rates while stripping caller-owned provenance', async () => {
    const identity = {
      currency: 'EUR',
      exchange_rate: 9,
      exchange_rate_source: 'global' as const,
      exchange_rate_source_version: 'forged',
      exchange_rate_effective_date: '1900-01-01',
      exchange_rate_set_at: 'forged',
      exchange_rate_set_by_user_id: 999,
      exchange_rate_reset_at: 'forged',
      exchange_rate_note: 'remove for identity',
    };
    await service.freezeRateForWrite(tripId, identity, ownerId);
    expect(identity).toMatchObject({
      exchange_rate: 1,
      exchange_rate_source: 'identity',
      exchange_rate_source_version: 'identity:EUR',
      exchange_rate_set_by_user_id: ownerId,
      exchange_rate_note: null,
    });
    expect(identity.exchange_rate_reset_at).toBeUndefined();

    const explicit: ExchangeRateWrite = {
      currency: 'USD',
      exchange_rate: 1.5,
      exchange_rate_note: 'bank rate',
    };
    await service.freezeRateForWrite(tripId, explicit, ownerId);
    expect(explicit).toMatchObject({ exchange_rate: 1.5, exchange_rate_source: 'explicit' });
    expect(explicit.exchange_rate_source_version).toMatch(/^explicit:/);
  });

  it('preserves an unchanged frozen rate and resolves a changed/new currency through Trip then Global', async () => {
    saveSnapshot('EUR', { EUR: 1, USD: 1.25, GBP: 0.8 });
    db.prepare(
      `INSERT INTO trip_exchange_rates
         (trip_id,currency,exchange_rate,source_version,set_at,set_by_user_id)
       VALUES (?, 'USD', 1.4, 'trip:usd', CURRENT_TIMESTAMP, ?)`,
    ).run(tripId, ownerId);

    const preserved = { exchange_rate_note: 'only note changed' };
    await service.freezeRateForWrite(tripId, preserved, ownerId, { currency: 'USD', exchange_rate: 1.1 });
    expect(preserved).toEqual({ exchange_rate_note: 'only note changed' });

    const trip = { currency: 'USD' };
    await service.freezeRateForWrite(tripId, trip, ownerId, { currency: 'GBP', exchange_rate: 0.7 });
    expect(trip).toMatchObject({ exchange_rate: 1.4, exchange_rate_source: 'trip' });

    const global = { currency: 'GBP' };
    await service.freezeRateForWrite(tripId, global, ownerId);
    expect(global).toMatchObject({ exchange_rate: 0.8, exchange_rate_source: 'global' });

    await expect(service.freezeRateForWrite(tripId, { currency: 'JPY' }, ownerId)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.freezeRateForWrite(tripId, { currency: 'USD', exchange_rate: 0 }, ownerId),
    ).rejects.toBeInstanceOf(InvalidExchangeRateError);
    const missingTrip = { currency: 'USD' };
    await service.freezeRateForWrite(99999, missingTrip, ownerId);
    expect(missingTrip).toEqual({ currency: 'USD' });
  });

  it('creates, lists, replaces, validates, and deletes Trip defaults', () => {
    expect(service.setTripExchangeRate(99999, 'USD', 1.2, ownerId)).toBeNull();
    expect(() => service.setTripExchangeRate(tripId, 'EUR', 1.2, ownerId)).toThrow(/identity rate/);
    expect(() => service.setTripExchangeRate(tripId, 'XX', 1.2, ownerId)).toThrow(InvalidExchangeRateError);
    expect(() => service.setTripExchangeRate(tripId, 'USD', Number.NaN, ownerId)).toThrow(InvalidExchangeRateError);

    expect(service.setTripExchangeRate(tripId, 'usd', 1.2, ownerId, 'first')).toMatchObject({
      currency: 'USD',
      exchange_rate: 1.2,
      note: 'first',
    });
    expect(service.setTripExchangeRate(tripId, 'USD', 1.3, ownerId, '')).toMatchObject({
      exchange_rate: 1.3,
      note: null,
    });
    expect(service.listTripExchangeRates(tripId)).toHaveLength(1);
    expect(service.deleteTripExchangeRate(tripId, 'USD')).toBe(true);
    expect(service.deleteTripExchangeRate(tripId, 'USD')).toBe(false);
  });

  it('previews and selectively applies a version-checked batch to expenses and settlements', async () => {
    saveSnapshot('EUR', { EUR: 1, USD: 1.25 });
    const expenseId = expense(1.25, 'global');
    const settlementId = settlement(1.3, 'explicit');
    const preview = (await service.previewTripExchangeRateUpdate(tripId, 'usd', 1.5, ownerId, 'new default')) as {
      preview_id: string;
      rows: Array<{ type: 'expense' | 'settlement'; id: number; selected: boolean }>;
    };
    expect(preview.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'expense', id: expenseId, selected: true }),
        expect.objectContaining({ type: 'settlement', id: settlementId, selected: false }),
      ]),
    );

    const applied = service.applyTripExchangeRateUpdate(
      tripId,
      preview.preview_id,
      [
        { type: 'expense', id: expenseId },
        { type: 'settlement', id: settlementId },
      ],
      ownerId,
      'USD',
    ) as { updated: unknown[]; rate: { exchange_rate: number } };
    expect(applied.updated).toHaveLength(2);
    expect(applied.rate.exchange_rate).toBe(1.5);
    expect(
      db
        .prepare('SELECT exchange_rate,exchange_rate_source,exchange_rate_note FROM budget_items WHERE id=?')
        .get(expenseId),
    ).toEqual({ exchange_rate: 1.5, exchange_rate_source: 'trip', exchange_rate_note: 'new default' });
    expect(
      db.prepare('SELECT exchange_rate,exchange_rate_source FROM budget_settlements WHERE id=?').get(settlementId),
    ).toEqual({ exchange_rate: 1.5, exchange_rate_source: 'trip' });
    expect(db.prepare('SELECT 1 FROM exchange_rate_batch_previews WHERE id=?').get(preview.preview_id)).toBeUndefined();
  });

  it('rejects invalid previews and selections before writing', async () => {
    expect(() => service.cleanupExpiredExchangeRatePreviews(Date.now())).not.toThrow();
    await expect(service.previewTripExchangeRateUpdate(tripId, 'USD', 0, ownerId)).rejects.toThrow(
      InvalidExchangeRateError,
    );
    await expect(service.previewTripExchangeRateUpdate(99999, 'USD', 1.2, ownerId)).rejects.toThrow(/Trip not found/);
    await expect(service.previewTripExchangeRateUpdate(tripId, 'EUR', 1.2, ownerId)).rejects.toThrow(/identity rate/);

    const expenseId = expense();
    const preview = (await service.previewTripExchangeRateUpdate(tripId, 'USD', 1.4, ownerId)) as {
      preview_id: string;
    };
    expect(() =>
      service.applyTripExchangeRateUpdate(tripId, preview.preview_id, [{ type: 'expense', id: expenseId }], memberId),
    ).toThrow(/preview not found/);
    expect(() => service.applyTripExchangeRateUpdate(tripId, preview.preview_id, [], ownerId, 'GBP')).toThrow(
      /currency does not match/,
    );
    expect(() =>
      service.applyTripExchangeRateUpdate(tripId, preview.preview_id, [{ type: 'expense', id: 99999 }], ownerId),
    ).toThrow(/outside this preview/);
  });

  it('rejects expired and stale-state previews with distinct conflicts', async () => {
    const expenseId = expense();
    const expired = (await service.previewTripExchangeRateUpdate(tripId, 'USD', 1.4, ownerId)) as {
      preview_id: string;
    };
    db.prepare("UPDATE exchange_rate_batch_previews SET created_at='2000-01-01 00:00:00' WHERE id=?").run(
      expired.preview_id,
    );
    expect(() => service.applyTripExchangeRateUpdate(tripId, expired.preview_id, [], ownerId)).toThrow(
      ExchangeRatePreviewExpiredError,
    );
    expect(db.prepare('SELECT 1 FROM exchange_rate_batch_previews WHERE id=?').get(expired.preview_id)).toBeUndefined();

    const stale = (await service.previewTripExchangeRateUpdate(tripId, 'USD', 1.4, ownerId)) as {
      preview_id: string;
    };
    db.prepare('UPDATE budget_items SET total_price=126 WHERE id=?').run(expenseId);
    expect(() => service.applyTripExchangeRateUpdate(tripId, stale.preview_id, [], ownerId)).toThrow(
      ExchangeRateConflictError,
    );
  });
});
