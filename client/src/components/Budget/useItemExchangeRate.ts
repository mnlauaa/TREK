import type { ExchangeRateResolution, ExchangeRateSource } from '@trek/shared';
import { useEffect, useRef, useState } from 'react';
import { exchangeRateRepo } from '../../repo/budgetRepo';

export interface ExistingFrozenRate {
  currency?: string | null;
  exchange_rate?: number;
  exchange_rate_source?: ExchangeRateSource;
  exchange_rate_source_version?: string | null;
  exchange_rate_effective_date?: string | null;
  exchange_rate_set_at?: string | null;
  exchange_rate_note?: string | null;
}

export const storedRateToDisplay = (storedRate: number): number | null =>
  Number.isFinite(storedRate) && storedRate > 0 ? 1 / storedRate : null;

export const displayRateToStored = (displayRate: number): number | null =>
  Number.isFinite(displayRate) && displayRate > 0 ? 1 / displayRate : null;

export const formatDisplayRate = (storedRate: number): string => {
  const displayed = storedRateToDisplay(storedRate);
  return displayed === null ? '' : Number(displayed.toPrecision(12)).toString();
};

function initialRate(
  tripId: number,
  tripCurrency: string,
  itemCurrency: string,
  existing: ExistingFrozenRate | null
): ExchangeRateResolution | null | undefined {
  const rate = existing?.exchange_rate;
  const source = existing?.exchange_rate_source;
  if (
    existing &&
    rate != null &&
    Number.isFinite(rate) &&
    rate > 0 &&
    (rate !== 1 || (source != null && source !== 'legacy'))
  ) {
    return {
      trip_id: tripId,
      trip_currency: tripCurrency,
      item_currency: itemCurrency,
      exchange_rate: rate,
      source: source || 'legacy',
      source_version: existing.exchange_rate_source_version || 'legacy',
      effective_date: existing.exchange_rate_effective_date || null,
      fetched_at: existing.exchange_rate_set_at || null,
      stale: false,
    };
  }
  if (itemCurrency !== tripCurrency) return existing ? null : undefined;
  return {
    trip_id: tripId,
    trip_currency: tripCurrency,
    item_currency: itemCurrency,
    exchange_rate: 1,
    source: 'identity',
    source_version: `identity:${tripCurrency}`,
    effective_date: null,
    fetched_at: null,
    stale: false,
  };
}

function itemRateKey(
  tripId: number,
  tripCurrency: string,
  currency: string,
  existing: ExistingFrozenRate | null,
  enabled: boolean
): string {
  return JSON.stringify([
    tripId,
    tripCurrency,
    currency,
    enabled,
    Boolean(existing),
    existing?.exchange_rate,
    existing?.exchange_rate_source,
    existing?.exchange_rate_source_version,
    existing?.exchange_rate_effective_date,
    existing?.exchange_rate_set_at,
    existing?.exchange_rate_note,
  ]);
}

type RateDraft = { value?: string; note?: string };

function itemRateView(
  draft: RateDraft,
  suggestion: ExchangeRateResolution | null,
  matching: ExistingFrozenRate | null,
  sameCurrency: boolean
) {
  const value = draft.value ?? (suggestion ? formatDisplayRate(suggestion.exchange_rate) : '');
  const note = draft.note ?? matching?.exchange_rate_note ?? '';
  const manual = draft.value !== undefined;
  const numeric = Number(value);
  const storedRate = manual ? displayRateToStored(numeric) : (suggestion?.exchange_rate ?? null);

  return {
    value,
    note,
    manual,
    valid: sameCurrency || (manual ? storedRate !== null : matching !== null || suggestion !== null),
    storedRate,
    displayRate: Number.isFinite(numeric) && numeric > 0 ? numeric : null,
    write:
      manual && !sameCurrency && storedRate !== null
        ? { exchange_rate: storedRate, exchange_rate_note: note.trim() || null }
        : {},
  };
}

export function useItemExchangeRate(
  tripId: number,
  currency: string,
  tripCurrency: string,
  existing?: ExistingFrozenRate | null,
  enabled = true
) {
  const currentCurrency = currency.toUpperCase();
  const accountingCurrency = tripCurrency.toUpperCase();
  const sameCurrency = currentCurrency === accountingCurrency;
  const matching =
    existing && (existing.currency || accountingCurrency).toUpperCase() === currentCurrency ? existing : null;
  const rateKey = itemRateKey(tripId, accountingCurrency, currentCurrency, matching, enabled);
  const [previousKey, setPreviousKey] = useState(rateKey);
  const [draft, setDraft] = useState<RateDraft>({});
  const [remote, setRemote] = useState<{ quote: ExchangeRateResolution | null } | null>(null);
  const manualRevision = useRef(0);
  if (rateKey !== previousKey) {
    setPreviousKey(rateKey);
    setDraft({});
    setRemote(null);
  }

  const initial = initialRate(tripId, accountingCurrency, currentCurrency, matching);
  const shouldResolve = enabled && initial === undefined;
  useEffect(() => {
    if (!shouldResolve) return;
    let active = true;
    const revision = manualRevision.current;
    void exchangeRateRepo.resolve(tripId, currentCurrency).then(
      (quote) => {
        if (active && revision === manualRevision.current) setRemote({ quote });
      },
      () => {
        if (active && revision === manualRevision.current) setRemote({ quote: null });
      }
    );
    return () => {
      active = false;
    };
  }, [currentCurrency, rateKey, shouldResolve, tripId]);

  const setManualValue = (next: string) => {
    manualRevision.current += 1;
    setDraft((current) => ({ ...current, value: next.replace(',', '.') }));
  };
  const setNote = (note: string) => setDraft((current) => ({ ...current, note }));
  const quote = initial === undefined ? remote?.quote : initial;
  const suggestion =
    quote?.trip_id === tripId && quote.trip_currency === accountingCurrency && quote.item_currency === currentCurrency
      ? quote
      : null;
  const view = itemRateView(draft, suggestion, matching, sameCurrency);
  return {
    ...view,
    suggestion,
    setManualValue,
    setNote,
    loading: shouldResolve && !view.manual && remote === null,
    unavailable: !view.manual && quote === null,
  };
}
