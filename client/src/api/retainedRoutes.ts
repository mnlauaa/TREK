import type {
  ExchangeRateBatchApplyResult,
  ExchangeRateBatchPreview,
  ExchangeRateResolution,
  ExchangeRateSnapshot,
  GuestIdentityTransferCandidatesResponse,
  GuestIdentityTransferResponse,
  NewMemberIdentityCheckResponse,
  TripExchangeRate,
} from '@trek/shared';
import type { AxiosInstance } from 'axios';

export const createGuestIdentityApi = (apiClient: AxiosInstance) => ({
  runNewMemberIdentityCheck: (id: number | string): Promise<NewMemberIdentityCheckResponse> =>
    apiClient.post(`/trips/${id}/new-member-identity-check`).then((r) => r.data),
  declineNewMemberIdentityCheck: (id: number | string) =>
    apiClient.post(`/trips/${id}/new-member-identity-check/decline`).then((r) => r.data),
  guestIdentityTransferCandidates: (id: number | string): Promise<GuestIdentityTransferCandidatesResponse> =>
    apiClient.get(`/trips/${id}/guest-identity-transfers/candidates`).then((r) => r.data),
  transferGuestIdentity: (id: number | string, guestUserId: number): Promise<GuestIdentityTransferResponse> =>
    apiClient.post(`/trips/${id}/guests/${guestUserId}/identity-transfer`).then((r) => r.data),
});

export const createExchangeRateApi = (apiClient: AxiosInstance) => ({
  listExchangeRates: (tripId: number | string): Promise<{ rates: TripExchangeRate[] }> =>
    apiClient.get(`/trips/${tripId}/exchange-rates`).then((r) => r.data),
  resolveExchangeRate: (tripId: number | string, currency: string): Promise<ExchangeRateResolution> =>
    apiClient.get(`/trips/${tripId}/exchange-rates/resolve`, { params: { currency } }).then((r) => r.data),
  setExchangeRate: (tripId: number | string, currency: string, exchange_rate: number, note?: string | null) =>
    apiClient
      .put(`/trips/${tripId}/exchange-rates/${encodeURIComponent(currency)}`, { exchange_rate, note })
      .then((r) => r.data),
  deleteExchangeRate: (tripId: number | string, currency: string) =>
    apiClient.delete(`/trips/${tripId}/exchange-rates/${encodeURIComponent(currency)}`).then((r) => r.data),
  previewExchangeRate: (
    tripId: number | string,
    currency: string,
    exchange_rate: number,
    note?: string | null
  ): Promise<ExchangeRateBatchPreview> =>
    apiClient
      .post(`/trips/${tripId}/exchange-rates/${encodeURIComponent(currency)}/preview`, { exchange_rate, note })
      .then((r) => r.data),
  applyExchangeRate: (
    tripId: number | string,
    currency: string,
    preview_id: string,
    selected: Array<{ type: 'expense' | 'settlement'; id: number }>
  ): Promise<ExchangeRateBatchApplyResult> =>
    apiClient
      .post(`/trips/${tripId}/exchange-rates/${encodeURIComponent(currency)}/apply`, { preview_id, selected })
      .then((r) => r.data),
});

export const createExchangeRateSnapshotApi = (apiClient: AxiosInstance) => ({
  snapshot: (base = 'EUR'): Promise<ExchangeRateSnapshot> =>
    apiClient.get('/exchange-rates', { params: { base } }).then((r) => r.data),
});
