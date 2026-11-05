import { useEffect, useMemo, useState } from 'react';

import ExchangeRateManager from '../../../../components/Budget/ExchangeRateManager';
import { budgetRepo } from '../../../../repo/budgetRepo';
import MSheet from '../../../components/MSheet';
import type { MTripSheetsProps } from '../MTripShell';
import { FormSheetHeader } from './PlSheetChrome';

interface SettlementCurrency {
  currency?: string | null;
}

export default function MExchangeRateSheet({ planner, shell }: MTripSheetsProps) {
  if (shell.sheet?.id !== 'rates') return null;
  return <ExchangeRateSheet key={planner.tripId} planner={planner} shell={shell} />;
}

function ExchangeRateSheet({ planner, shell }: MTripSheetsProps) {
  const { t, tripId, trip, budgetItems } = planner;
  const tripCurrency = (trip?.currency || 'EUR').toUpperCase();
  const canEdit = planner.can('budget_edit', trip);
  const [settlements, setSettlements] = useState<SettlementCurrency[]>([]);

  useEffect(() => {
    let active = true;
    budgetRepo
      .settlement(tripId, tripCurrency)
      .then((result: { settlements?: SettlementCurrency[] }) => {
        if (active) setSettlements(result.settlements || []);
      })
      .catch(() => {
        if (active) setSettlements([]);
      });
    return () => {
      active = false;
    };
  }, [tripCurrency, tripId]);

  const usedCurrencies = useMemo(
    () => [
      ...budgetItems.map((item) => (item.currency || tripCurrency).toUpperCase()),
      ...settlements.map((item) => (item.currency || tripCurrency).toUpperCase()),
    ],
    [budgetItems, settlements, tripCurrency]
  );

  return (
    <MSheet open onClose={shell.closeSheet} material="opaque" ariaLabel={t('costs.exchangeRates.title')}>
      <FormSheetHeader
        title={t('costs.exchangeRates.title')}
        onClose={shell.closeSheet}
        closeLabel={t('common.close')}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-5 pt-2">
        <ExchangeRateManager
          tripId={tripId}
          tripCurrency={tripCurrency}
          usedCurrencies={usedCurrencies}
          canEdit={canEdit}
        />
      </div>
    </MSheet>
  );
}
