import type { ChildTransport } from './plugin-sdk';

export interface PluginCostsApi {
  getByTrip(tripId: number): Promise<unknown[]>;
  listMine(): Promise<unknown[]>;
  create(tripId: number, input: Record<string, unknown>): Promise<unknown>;
  update(tripId: number, itemId: number, input: Record<string, unknown>): Promise<unknown>;
  delete(tripId: number, itemId: number): Promise<{ deleted: boolean }>;
  listRates(tripId: number): Promise<unknown[]>;
  resolveRate(tripId: number, currency: string): Promise<unknown>;
  setRate(tripId: number, currency: string, exchangeRate: number, note?: string): Promise<unknown>;
  deleteRate(tripId: number, currency: string): Promise<{ deleted: boolean }>;
  listSettlements(tripId: number): Promise<unknown[]>;
  createSettlement(tripId: number, input: Record<string, unknown>): Promise<unknown>;
  updateSettlement(tripId: number, settlementId: number, input: Record<string, unknown>): Promise<unknown>;
  deleteSettlement(tripId: number, settlementId: number): Promise<{ deleted: boolean }>;
}

export function buildPluginCostsApi(t: ChildTransport, invocationId?: string): PluginCostsApi {
  return {
    getByTrip: (tripId) => t.rpc('costs.getByTrip', { tripId, _inv: invocationId }) as Promise<unknown[]>,
    listMine: () => t.rpc('costs.listMine', { _inv: invocationId }) as Promise<unknown[]>,
    create: (tripId, input) => t.rpc('costs.create', { tripId, input, _inv: invocationId }),
    update: (tripId, itemId, input) => t.rpc('costs.update', { tripId, itemId, input, _inv: invocationId }),
    delete: (tripId, itemId) =>
      t.rpc('costs.delete', { tripId, itemId, _inv: invocationId }) as Promise<{ deleted: boolean }>,
    listRates: (tripId) => t.rpc('costs.listRates', { tripId, _inv: invocationId }) as Promise<unknown[]>,
    resolveRate: (tripId, currency) => t.rpc('costs.resolveRate', { tripId, currency, _inv: invocationId }),
    setRate: (tripId, currency, exchangeRate, note) =>
      t.rpc('costs.setRate', { tripId, currency, exchangeRate, note, _inv: invocationId }),
    deleteRate: (tripId, currency) =>
      t.rpc('costs.deleteRate', { tripId, currency, _inv: invocationId }) as Promise<{ deleted: boolean }>,
    listSettlements: (tripId) => t.rpc('costs.listSettlements', { tripId, _inv: invocationId }) as Promise<unknown[]>,
    createSettlement: (tripId, input) => t.rpc('costs.createSettlement', { tripId, input, _inv: invocationId }),
    updateSettlement: (tripId, settlementId, input) =>
      t.rpc('costs.updateSettlement', { tripId, settlementId, input, _inv: invocationId }),
    deleteSettlement: (tripId, settlementId) =>
      t.rpc('costs.deleteSettlement', { tripId, settlementId, _inv: invocationId }) as Promise<{ deleted: boolean }>,
  };
}
