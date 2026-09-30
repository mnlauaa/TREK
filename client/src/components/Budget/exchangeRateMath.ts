import { convertBooked } from '../../hooks/useExchangeRates';

export function frozenTransactionAmountToDisplay(
  amount: number,
  currency: string | null | undefined,
  exchangeRate: number | null | undefined,
  tripCurrency: string,
  convertToDisplay: (amount: number, currency: string | null | undefined) => number,
  source?: string | null
): number {
  return convertBooked(amount, currency, exchangeRate, tripCurrency, convertToDisplay, source);
}
