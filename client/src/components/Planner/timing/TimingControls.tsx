import { formatDurationShort } from '@trek/shared/roadtrip';
import { ChevronRight, Clock, Pencil } from 'lucide-react';
import { createElement, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { useSettingsStore } from '../../../store/settingsStore';
import { useTripStore } from '../../../store/tripStore';
import type { Day } from '../../../types';
import { formatClockTime } from '../../../utils/formatters';
import CustomTimePicker from '../../shared/CustomTimePicker';
import { fs } from '../../shared/DialogShell';
import { NumericInput } from '../../shared/NumericInput';
import { routeModeIcon } from '../routeModes';
import type { TimingPlan } from './ItineraryTiming';
import { defaultDayTiming } from './itineraryTimingModel';
import { button, useTimingSave, validClock } from './useTimingSave';

export function DayTimingControls({ day, tripId, editable }: { day: Day; tripId: number | string; editable: boolean }) {
  const { t } = useTranslation();
  const is12h = useSettingsStore((s) => s.settings.time_format) === '12h';
  const timing = day.timing ?? defaultDayTiming();
  const [draft, setDraft] = useState<string | null>(null);
  const { busy, run } = useTimingSave();
  return (
    <div className="space-y-1 px-3 py-2" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        role="switch"
        aria-checked={timing.enabled}
        disabled={!editable || busy || draft !== null}
        onClick={() =>
          void run(() => useTripStore.getState().setDayTiming(tripId, day.id, { ...timing, enabled: !timing.enabled }))
        }
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-content-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        style={fs(12)}
      >
        <span className="font-medium">{t('timing.enabled')}</span>
        <span
          aria-hidden="true"
          className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${timing.enabled ? 'bg-accent' : 'bg-edge'}`}
        >
          <span
            className={`h-5 w-5 rounded-full transition-transform ${timing.enabled ? 'translate-x-5 bg-accent-text rtl:-translate-x-5' : 'bg-surface'}`}
          />
        </span>
      </button>
      {draft === null ? (
        <button
          type="button"
          disabled={!editable || busy || !timing.enabled}
          aria-expanded={false}
          className="inline-flex min-h-9 items-center gap-2 rounded-full border border-edge-faint px-3 font-geist font-medium text-content-secondary hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
          style={fs(11.5)}
          onClick={() => setDraft(timing.start)}
        >
          <Clock size={13} />
          {t('roadtrip.window.start')} {formatClockTime(timing.start, is12h)}
          <ChevronRight size={13} />
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-caption text-content-secondary">
          <p className="w-full text-content-muted">{t('timing.help')}</p>
          <span className="w-full">{t('roadtrip.window.start')}</span>
          <CustomTimePicker aria-label={t('roadtrip.window.start')} value={draft} disabled={busy} onChange={setDraft} />
          <button
            type="button"
            className={button}
            disabled={!editable || busy || !validClock(draft)}
            onClick={() =>
              void run(async () => {
                await useTripStore.getState().setDayTiming(tripId, day.id, { ...timing, start: draft });
                setDraft(null);
              })
            }
          >
            {t('common.save')}
          </button>
          <button type="button" className={button} disabled={busy} onClick={() => setDraft(null)}>
            {t('common.cancel')}
          </button>
        </div>
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
  const duration = leg.seconds === undefined ? t('timing.travelMissing') : formatDurationShort(leg.seconds);
  const edit = () => {
    setDraft(leg.manual === undefined ? '' : String(leg.manual));
    setOpen(true);
  };
  return (
    <div className="flex flex-wrap items-center justify-center gap-1 px-3 py-1 text-content-muted" style={fs(10.5)}>
      {!open && (
        <>
          <span className="h-px flex-1 bg-edge-faint" />
          {editable ? (
            <button
              type="button"
              onClick={edit}
              aria-label={`${t('timing.travel')} · ${duration}`}
              className="inline-flex min-h-7 items-center gap-1 rounded-full bg-surface-secondary px-2 font-geist font-medium focus-visible:ring-2 focus-visible:ring-accent"
            >
              {createElement(routeModeIcon(leg.mode), { size: 11 })}
              {duration}
              {leg.seconds === undefined && <Pencil size={11} aria-hidden="true" className="shrink-0" />}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1">
              {createElement(routeModeIcon(leg.mode), { size: 11 })}
              {duration}
            </span>
          )}
          <span className="h-px flex-1 bg-edge-faint" />
        </>
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
