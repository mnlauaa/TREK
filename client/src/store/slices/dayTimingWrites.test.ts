import 'fake-indexeddb/auto';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDay } from '../../../tests/helpers/factories';
import { server } from '../../../tests/helpers/msw/server';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { clearAll, offlineDb } from '../../db/offlineDb';
import { useTripStore } from '../tripStore';

beforeEach(async () => {
  resetAllStores();
  await clearAll();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('concurrent day timing writes', () => {
  it.each([
    [true, true],
    [false, true],
    [true, false],
    [false, false],
  ])(
    'serializes server writes and preserves latest intent (first=%s, second=%s)',
    async (firstSucceeds, secondSucceeds) => {
      const original = { enabled: true, start: '09:00', travel: [] };
      const first = { ...original, start: '08:00' };
      const latest = { ...first, travel: [{ from: 'assignment:1', to: 'assignment:2', mode: 'walking', minutes: 15 }] };
      const day = buildDay({ id: 81, trip_id: 5, timing: original });
      seedStore(useTripStore, { days: [day] });
      await offlineDb.days.put(day);
      const releases = [deferred(), deferred()];
      const requests: unknown[] = [];
      server.use(
        http.put('/api/trips/5/days/81/timing', async ({ request }) => {
          const index = requests.length;
          const timing = await request.json();
          requests.push(timing);
          await releases[index]?.promise;
          if (!(index === 0 ? firstSucceeds : secondSucceeds))
            return HttpResponse.json({ error: 'Failed' }, { status: 400 });
          return HttpResponse.json({ day: { ...day, timing } });
        })
      );
      const savingFirst = useTripStore
        .getState()
        .setDayTiming(5, 81, first)
        .then(
          () => true,
          () => false
        );
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      const savingLatest = useTripStore
        .getState()
        .setDayTiming(5, 81, latest)
        .then(
          () => true,
          () => false
        );
      expect(useTripStore.getState().days[0]?.timing).toEqual(latest);
      expect(requests).toHaveLength(1);
      releases[0]?.resolve();
      expect(await savingFirst).toBe(firstSucceeds);
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      expect(useTripStore.getState().days[0]?.timing).toEqual(latest);
      releases[1]?.resolve();
      expect(await savingLatest).toBe(secondSucceeds);
      const expected = secondSucceeds ? latest : firstSucceeds ? first : original;
      expect(useTripStore.getState().days[0]?.timing).toEqual(expected);
      expect((await offlineDb.days.get(81))?.timing).toEqual(expected);
      expect(requests).toEqual([first, latest]);
    }
  );
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
