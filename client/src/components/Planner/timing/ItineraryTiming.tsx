import { appointmentConflicts, visitStay, visitTimes } from '@trek/shared';
import { formatDurationShort, parseClock } from '@trek/shared/roadtrip';
import { useState } from 'react';
import { useTranslation } from '../../../i18n';
import { useSettingsStore } from '../../../store/settingsStore';
import { useTripStore } from '../../../store/tripStore';
import type { Assignment, Day, Reservation } from '../../../types';
import { formatClockTime } from '../../../utils/formatters';
import RoadtripStayModal, { type StayDraft } from '../../Roadtrip/RoadtripStayModal';
import CustomTimePicker from '../../shared/CustomTimePicker';
import { type buildItineraryTiming } from './itineraryTimingModel';
import { button, useTimingSave, validClock } from './useTimingSave';

export type TimingPlan = ReturnType<typeof buildItineraryTiming>;
export { DayTimingControls, TravelTimingControl } from './TimingControls';

export function VisitTiming({
  assignment,
  day,
  tripId,
  plan,
  editable,
  bookings,
  onOpenBooking,
  onStay,
}: {
  assignment: Assignment;
  day: Day;
  tripId: number | string;
  plan?: TimingPlan;
  editable: boolean;
  bookings: Reservation[];
  onOpenBooking?: (booking: Reservation) => void;
  onStay?: (draft: StayDraft) => void;
}) {
  const { t } = useTranslation();
  const is12h = useSettingsStore((s) => s.settings.time_format) === '12h';
  const [expanded, setExpanded] = useState(false);
  const [stayDraft, setStayDraft] = useState<StayDraft | null>(null);
  const { busy, run } = useTimingSave();
  const times = visitTimes(assignment);
  const [timeDraft, setTimeDraft] = useState<typeof times | null>(null);
  const fields = timeDraft ?? times;
  const { entry, conflicts, warnings, stay } = visitReading(assignment, plan, bookings, day.date);
  const display = (clock: string | null | undefined, offset = 0) =>
    clock
      ? `${formatClockTime(clock, is12h)}${offset ? ` ${t('timing.dayOffset', { count: offset })}` : ''}`
      : t('timing.unknown');
  const fixed = !!times.start || !!times.end;
  const editStay = () => {
    const draft: StayDraft = {
      assignmentId: assignment.id,
      dayId: assignment.day_id,
      placeId: assignment.place_id,
      name: assignment.place.name,
      minutes: visitStay(assignment),
      arrival: entry?.arrival,
      departure: entry?.departure,
    };
    if (onStay) onStay(draft);
    else setStayDraft(draft);
  };
  const saveTimes = () =>
    void run(async () => {
      await useTripStore.getState().setAssignmentTimes(tripId, day.id, assignment.id, {
        place_time: fields.start || null,
        end_time: fields.end || null,
      });
      setTimeDraft(null);
      if (!fields.start && !fields.end) setExpanded(false);
    });
  return (
    <div
      className="flex min-w-0 flex-col gap-1 py-1 text-caption text-content-secondary"
      onClick={(e) => e.stopPropagation()}
    >
      {entry && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums" aria-live="polite">
          <span>
            {t('timing.arrival')} {display(entry.arrival, entry.dayOffset)}
          </span>
          <span>
            {t('timing.departure')} {display(entry.departure, entry.departureDayOffset ?? entry.dayOffset)}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {editable && !times.end ? (
          <button
            type="button"
            className={button}
            disabled={busy || assignment.id < 0}
            aria-label={`${t('roadtrip.stop.stay')} · ${formatDurationShort((stay ?? 0) * 60)}`}
            onClick={editStay}
          >
            {t('roadtrip.stop.stayShort')} · {formatDurationShort((stay ?? 0) * 60)}
          </button>
        ) : (
          <span>
            {t('roadtrip.stop.stayShort')} · {stay === null ? t('timing.unknown') : formatDurationShort(stay * 60)}
          </span>
        )}
        {editable && !fixed && !expanded && (
          <button type="button" className={button} onClick={() => setExpanded(true)}>
            {t('timing.fixed')}
          </button>
        )}
      </div>
      {(fixed || expanded) && (
        <FixedVisitTimes
          assignmentId={assignment.id}
          fields={fields}
          times={times}
          editable={editable}
          busy={busy}
          hasDraft={!!timeDraft}
          setDraft={setTimeDraft}
          save={saveTimes}
          display={display}
        />
      )}
      {warnings.map((warning, i) => (
        <p key={i} role="status" className="text-warning">
          {t(`roadtrip.warn.${warning.code}`, { minutes: warning.minutes ?? 0 })}
        </p>
      ))}
      {bookings.map((booking) => (
        <div key={booking.id} className="flex flex-wrap items-center gap-1">
          <span>
            {booking.title}{' '}
            {booking.reservation_time ? formatClockTime(booking.reservation_time.split('T').pop(), is12h) : ''}
          </span>
          {onOpenBooking && (
            <button type="button" className={button} onClick={() => onOpenBooking(booking)}>
              {t('timing.booking')}
            </button>
          )}
          {conflicts.includes(booking.id) && (
            <span role="status" className="text-warning">
              {t('timing.bookingConflict')}
            </span>
          )}
        </div>
      ))}
      <RoadtripStayModal
        stop={stayDraft}
        onClose={() => setStayDraft(null)}
        onSave={async (_placeId, minutes) =>
          useTripStore.getState().setAssignmentStay(tripId, day.id, assignment.id, minutes)
        }
      />
    </div>
  );
}

function visitReading(
  assignment: Assignment,
  plan: TimingPlan | undefined,
  bookings: Reservation[],
  date: Day['date']
) {
  const times = visitTimes(assignment);
  const index = plan?.nodes.findIndex((n) => n.assignment?.id === assignment.id) ?? -1;
  const entry = index >= 0 ? plan?.schedule.entries[index] : undefined;
  const absolute = (value: string | null | undefined, offset = 0) => {
    const minutes = parseClock(value);
    return minutes === null ? null : minutes + offset * 1440;
  };
  const arrival = absolute(entry?.arrival, entry?.dayOffset);
  const departure = absolute(entry?.departure, entry?.departureDayOffset ?? entry?.dayOffset);
  const conflicts = appointmentConflicts(bookings, arrival, departure, date);
  const warnings = plan?.schedule.warnings.filter((w) => w.index === index && w.code !== 'overnight') ?? [];
  const stay = times.end
    ? arrival !== null && departure !== null
      ? departure - arrival
      : null
    : visitStay(assignment);
  return { entry, conflicts, warnings, stay };
}

function FixedVisitTimes({
  assignmentId,
  fields,
  times,
  editable,
  busy,
  hasDraft,
  setDraft,
  save,
  display,
}: {
  assignmentId: number;
  fields: ReturnType<typeof visitTimes>;
  times: ReturnType<typeof visitTimes>;
  editable: boolean;
  busy: boolean;
  hasDraft: boolean;
  setDraft: (draft: ReturnType<typeof visitTimes> | null) => void;
  save: () => void;
  display: (clock: string | null | undefined, offset?: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {editable ? (
        <>
          <label>
            {t('places.startTime')}
            <CustomTimePicker
              aria-label={t('places.startTime')}
              value={fields.start ?? ''}
              aria-invalid={!!fields.start && !validClock(fields.start)}
              disabled={busy || assignmentId < 0}
              onChange={(start) => setDraft({ ...fields, start })}
            />
          </label>
          <label>
            {t('places.endTime')}
            <CustomTimePicker
              aria-label={t('places.endTime')}
              value={fields.end ?? ''}
              aria-invalid={!!fields.end && !validClock(fields.end)}
              disabled={busy || assignmentId < 0}
              onChange={(end) => setDraft({ ...fields, end })}
            />
          </label>
          {hasDraft && (
            <>
              <button
                type="button"
                className={button}
                disabled={
                  busy || (!!fields.start && !validClock(fields.start)) || (!!fields.end && !validClock(fields.end))
                }
                onClick={save}
              >
                {t('common.save')}
              </button>
              <button type="button" className={button} disabled={busy} onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </button>
            </>
          )}
        </>
      ) : (
        <span>
          {t('timing.fixed')} · {display(times.start)} – {display(times.end)}
        </span>
      )}
    </div>
  );
}
