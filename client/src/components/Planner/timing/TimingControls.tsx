import type { DayTiming } from '@trek/shared';
import { formatDurationShort } from '@trek/shared/roadtrip';
import { useState } from 'react';
import { useTranslation } from '../../../i18n';
import { useTripStore } from '../../../store/tripStore';
import type { Day } from '../../../types';
import CustomTimePicker from '../../shared/CustomTimePicker';
import { NumericInput } from '../../shared/NumericInput';
import type { TimingPlan } from './ItineraryTiming';
import { defaultDayTiming } from './itineraryTimingModel';
import { button, useTimingSave, validClock } from './useTimingSave';

export function DayTimingControls({ day, tripId, editable }: { day: Day; tripId: number | string; editable: boolean }) {
  const { t } = useTranslation();
  const timing = day.timing ?? defaultDayTiming();
  const [startDraft, setStartDraft] = useState<string | null>(null);
  const { busy, run } = useTimingSave();
  const save = (patch: Partial<DayTiming>) =>
    void run(() => useTripStore.getState().setDayTiming(tripId, day.id, { ...timing, ...patch }));
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-caption text-content-secondary">
      <label className="flex min-h-9 items-center gap-2">
        <input
          type="checkbox"
          checked={timing.enabled}
          disabled={!editable || busy}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        {t('timing.enabled')}
      </label>
      {timing.enabled && (
        <CustomTimePicker
          aria-label={t('roadtrip.window.start')}
          value={startDraft ?? timing.start}
          disabled={!editable || busy}
          onChange={setStartDraft}
        />
      )}
      {startDraft !== null && (
        <>
          <button
            type="button"
            className={button}
            disabled={busy || !validClock(startDraft)}
            onClick={() =>
              void run(async () => {
                await useTripStore.getState().setDayTiming(tripId, day.id, { ...timing, start: startDraft });
                setStartDraft(null);
              })
            }
          >
            {t('common.save')}
          </button>
          <button type="button" className={button} disabled={busy} onClick={() => setStartDraft(null)}>
            {t('common.cancel')}
          </button>
        </>
      )}
    </div>
  );
}

export function TravelTimingControl({
  day,
  tripId,
  leg,
  editable,
}: {
  day: Day;
  tripId: number | string;
  leg: TimingPlan['legs'][number];
  editable: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const { busy, run } = useTimingSave();
  const invalid = draft !== '' && (!Number.isInteger(Number(draft)) || Number(draft) < 0 || Number(draft) > 1440);
  const save = () =>
    void run(async () => {
      const timing = day.timing ?? defaultDayTiming();
      const travel = timing.travel.filter((l) => !(l.from === leg.from && l.to === leg.to && l.mode === leg.mode));
      if (draft !== '') travel.push({ from: leg.from, to: leg.to, mode: leg.mode, minutes: Number(draft) });
      await useTripStore.getState().setDayTiming(tripId, day.id, { ...timing, travel });
      setOpen(false);
    });
  return (
    <div className="flex flex-wrap items-center gap-2 py-1 text-caption text-content-muted">
      <span>
        {t('timing.travel')} · {leg.seconds === undefined ? t('timing.unknown') : formatDurationShort(leg.seconds)}
      </span>
      {editable && !open && (
        <button
          type="button"
          className={button}
          onClick={() => {
            setDraft(leg.manual === undefined ? '' : String(leg.manual));
            setOpen(true);
          }}
        >
          {t('common.edit')}
        </button>
      )}
      {open && (
        <>
          <NumericInput
            placeholder="0–1440"
            aria-label={t('timing.travel')}
            aria-invalid={invalid}
            value={draft}
            onValueChange={setDraft}
            disabled={busy}
            className="w-20 rounded border border-edge bg-surface-input px-2 py-1 text-content"
          />
          <button type="button" className={button} disabled={busy || invalid} onClick={save}>
            {t('common.save')}
          </button>
          <button type="button" className={button} disabled={busy} onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
          {leg.manual !== undefined && (
            <button type="button" className={button} disabled={busy} onClick={() => setDraft('')}>
              {t('common.reset')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
