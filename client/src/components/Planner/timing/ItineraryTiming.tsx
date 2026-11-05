import { useState } from 'react'
import { appointmentConflicts, visitStay, visitTimes, type DayTiming } from '@trek/shared'
import { formatDurationShort, parseClock } from '@trek/shared/roadtrip'
import type { Assignment, Day, Reservation } from '../../../types'
import { useTranslation } from '../../../i18n'
import { useSettingsStore } from '../../../store/settingsStore'
import { useTripStore } from '../../../store/tripStore'
import { useToast } from '../../shared/Toast'
import CustomTimePicker from '../../shared/CustomTimePicker'
import { NumericInput } from '../../shared/NumericInput'
import RoadtripStayModal, { type StayDraft } from '../../Roadtrip/RoadtripStayModal'
import { formatClockTime } from '../../../utils/formatters'
import { defaultDayTiming, type buildItineraryTiming } from './itineraryTimingModel'

export type TimingPlan = ReturnType<typeof buildItineraryTiming>
const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const button = 'min-h-9 [@media(pointer:coarse)]:min-h-11 rounded px-2 py-1 text-caption text-accent-on hover:bg-accent-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50'

function useTimingSave() {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const { t } = useTranslation()
  const run = async (save: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await save() }
    catch (error) { toast.error(error instanceof Error ? error.message : t('common.unknownError')) }
    finally { setBusy(false) }
  }
  return { busy, run }
}

export function DayTimingControls({ day, tripId, editable }: { day: Day; tripId: number | string; editable: boolean }) {
  const { t } = useTranslation()
  const timing = day.timing ?? defaultDayTiming()
  const [startDraft, setStartDraft] = useState<string | null>(null)
  const { busy, run } = useTimingSave()
  const save = (patch: Partial<DayTiming>) => void run(() => useTripStore.getState().setDayTiming(tripId, day.id, { ...timing, ...patch }))
  return <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-caption text-content-secondary">
    <label className="flex min-h-9 items-center gap-2">
      <input type="checkbox" checked={timing.enabled} disabled={!editable || busy} onChange={e => save({ enabled: e.target.checked })} />
      {t('timing.enabled')}
    </label>
    {timing.enabled && <CustomTimePicker aria-label={t('roadtrip.window.start')} value={startDraft ?? timing.start} disabled={!editable || busy} onChange={setStartDraft} />}
    {startDraft !== null && <>
      <button type="button" className={button} disabled={busy || !validClock(startDraft)} onClick={() => void run(async () => {
        await useTripStore.getState().setDayTiming(tripId, day.id, { ...timing, start: startDraft }); setStartDraft(null)
      })}>{t('common.save')}</button>
      <button type="button" className={button} disabled={busy} onClick={() => setStartDraft(null)}>{t('common.cancel')}</button>
    </>}
  </div>
}

export function VisitTiming({ assignment, day, tripId, plan, editable, bookings, onOpenBooking, onStay }: {
  assignment: Assignment; day: Day; tripId: number | string; plan?: TimingPlan; editable: boolean;
  bookings: Reservation[]; onOpenBooking?: (booking: Reservation) => void; onStay?: (draft: StayDraft) => void;
}) {
  const { t } = useTranslation()
  const is12h = useSettingsStore(s => s.settings.time_format) === '12h'
  const [expanded, setExpanded] = useState(false)
  const [stayDraft, setStayDraft] = useState<StayDraft | null>(null)
  const { busy, run } = useTimingSave()
  const times = visitTimes(assignment)
  const [timeDraft, setTimeDraft] = useState<typeof times | null>(null)
  const fields = timeDraft ?? times
  const index = plan?.nodes.findIndex(n => n.assignment?.id === assignment.id) ?? -1
  const entry = index >= 0 ? plan?.schedule.entries[index] : undefined
  const absolute = (value: string | null | undefined, offset = 0) => {
    const minutes = parseClock(value)
    return minutes === null ? null : minutes + offset * 1440
  }
  const arrival = absolute(entry?.arrival, entry?.dayOffset)
  const departure = absolute(entry?.departure, entry?.departureDayOffset ?? entry?.dayOffset)
  const conflicts = appointmentConflicts(bookings, arrival, departure, day.date)
  const warnings = plan?.schedule.warnings.filter(w => w.index === index && w.code !== 'overnight') ?? []
  const display = (clock: string | null | undefined, offset = 0) => clock ? `${formatClockTime(clock, is12h)}${offset ? ` ${t('timing.dayOffset', { days: offset })}` : ''}` : t('timing.unknown')
  const fixed = !!times.start || !!times.end
  const stay = times.end ? (arrival !== null && departure !== null ? departure - arrival : null) : visitStay(assignment)
  const editStay = () => {
    const draft: StayDraft = { assignmentId: assignment.id, dayId: assignment.day_id, placeId: assignment.place_id,
      name: assignment.place.name, minutes: visitStay(assignment), arrival: entry?.arrival, departure: entry?.departure }
    if (onStay) onStay(draft); else setStayDraft(draft)
  }
  const saveTimes = () => void run(async () => {
    await useTripStore.getState().setAssignmentTimes(tripId, day.id, assignment.id, { place_time: fields.start || null, end_time: fields.end || null })
    setTimeDraft(null)
    if (!fields.start && !fields.end) setExpanded(false)
  })
  return <div className="flex min-w-0 flex-col gap-1 py-1 text-caption text-content-secondary" onClick={e => e.stopPropagation()}>
    {entry && <div className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums" aria-live="polite">
      <span>{t('timing.arrival')} {display(entry.arrival, entry.dayOffset)}</span>
      <span>{t('timing.departure')} {display(entry.departure, entry.departureDayOffset ?? entry.dayOffset)}</span>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      {editable && !times.end ? <button type="button" className={button} disabled={busy || assignment.id < 0} aria-label={`${t('roadtrip.stop.stay')} · ${formatDurationShort((stay ?? 0) * 60)}`} onClick={editStay}>{t('roadtrip.stop.stayShort')} · {formatDurationShort((stay ?? 0) * 60)}</button>
        : <span>{t('roadtrip.stop.stayShort')} · {stay === null ? t('timing.unknown') : formatDurationShort(stay * 60)}</span>}
      {editable && !fixed && !expanded && <button type="button" className={button} onClick={() => setExpanded(true)}>{t('timing.fixed')}</button>}
    </div>
    {(fixed || expanded) && <div className="flex flex-wrap gap-2">
      {editable ? <>
        <label>{t('places.startTime')}<CustomTimePicker aria-label={t('places.startTime')} value={fields.start ?? ''} aria-invalid={!!fields.start && !validClock(fields.start)} disabled={busy || assignment.id < 0} onChange={start => setTimeDraft({ ...fields, start })} /></label>
        <label>{t('places.endTime')}<CustomTimePicker aria-label={t('places.endTime')} value={fields.end ?? ''} aria-invalid={!!fields.end && !validClock(fields.end)} disabled={busy || assignment.id < 0} onChange={end => setTimeDraft({ ...fields, end })} /></label>
        {timeDraft && <>
          <button type="button" className={button} disabled={busy || (!!fields.start && !validClock(fields.start)) || (!!fields.end && !validClock(fields.end))} onClick={saveTimes}>{t('common.save')}</button>
          <button type="button" className={button} disabled={busy} onClick={() => setTimeDraft(null)}>{t('common.cancel')}</button>
        </>}
      </> : <span>{t('timing.fixed')} · {display(times.start)} – {display(times.end)}</span>}
    </div>}
    {warnings.map((warning, i) => <p key={i} role="status" className="text-warning">{t(`roadtrip.warn.${warning.code}`, { minutes: warning.minutes ?? 0 })}</p>)}
    {bookings.map(booking => <div key={booking.id} className="flex flex-wrap items-center gap-1">
      <span>{booking.title} {booking.reservation_time ? formatClockTime(booking.reservation_time.split('T').pop(), is12h) : ''}</span>
      {onOpenBooking && <button type="button" className={button} onClick={() => onOpenBooking(booking)}>{t('timing.booking')}</button>}
      {conflicts.includes(booking.id) && <span role="status" className="text-warning">{t('timing.bookingConflict')}</span>}
    </div>)}
    <RoadtripStayModal stop={stayDraft} onClose={() => setStayDraft(null)} onSave={async (_placeId, minutes) => useTripStore.getState().setAssignmentStay(tripId, day.id, assignment.id, minutes)} />
  </div>
}

export function TravelTimingControl({ day, tripId, leg, editable }: { day: Day; tripId: number | string; leg: TimingPlan['legs'][number]; editable: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const { busy, run } = useTimingSave()
  const invalid = draft !== '' && (!Number.isInteger(Number(draft)) || Number(draft) < 0 || Number(draft) > 1440)
  const save = () => void run(async () => {
    const timing = day.timing ?? defaultDayTiming()
    const travel = timing.travel.filter(l => !(l.from === leg.from && l.to === leg.to && l.mode === leg.mode))
    if (draft !== '') travel.push({ from: leg.from, to: leg.to, mode: leg.mode, minutes: Number(draft) })
    await useTripStore.getState().setDayTiming(tripId, day.id, { ...timing, travel })
    setOpen(false)
  })
  return <div className="flex flex-wrap items-center gap-2 py-1 text-caption text-content-muted">
    <span>{t('timing.travel')} · {leg.seconds === undefined ? t('timing.unknown') : formatDurationShort(leg.seconds)}</span>
    {editable && !open && <button type="button" className={button} onClick={() => { setDraft(leg.manual === undefined ? '' : String(leg.manual)); setOpen(true) }}>{t('common.edit')}</button>}
    {open && <>
      <NumericInput placeholder="0–1440" aria-label={t('timing.travel')} aria-invalid={invalid} value={draft} onValueChange={setDraft} disabled={busy} className="w-20 rounded border border-edge bg-surface-input px-2 py-1 text-content" />
      <button type="button" className={button} disabled={busy || invalid} onClick={save}>{t('common.save')}</button>
      <button type="button" className={button} disabled={busy} onClick={() => setOpen(false)}>{t('common.cancel')}</button>
      {leg.manual !== undefined && <button type="button" className={button} disabled={busy} onClick={() => setDraft('')}>{t('common.reset')}</button>}
    </>}
  </div>
}
