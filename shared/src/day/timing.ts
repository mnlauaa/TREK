import type { Assignment } from '../assignment/assignment.schema';
import { computeSchedule, parseClock, type Schedule } from '../roadtrip/roadtripModel';
import type { DayTiming } from './day.schema';

export function visitStay(a: Pick<Assignment, 'stay_minutes' | 'place'>): number {
  return a.stay_minutes ?? a.place.duration_minutes ?? 60;
}

/** Saved clear is different from never overriding the place default. */
export function visitTimes(
  a: Pick<Assignment, 'assignment_time' | 'assignment_end_time' | 'times_explicit' | 'place'>,
) {
  return {
    start: a.times_explicit ? (a.assignment_time ?? null) : (a.assignment_time ?? a.place.place_time ?? null),
    end: a.times_explicit ? (a.assignment_end_time ?? null) : (a.assignment_end_time ?? a.place.end_time ?? null),
  };
}

export function itinerarySchedule(
  assignments: Assignment[],
  legs: (number | undefined)[],
  timing: DayTiming,
  initialTravelSeconds?: number,
): Schedule {
  const start = parseClock(timing.start)!;
  return computeSchedule(
    assignments.map((a) => {
      const times = visitTimes(a);
      const end = parseClock(times.end);
      return {
        anchor: times.start,
        dwellMinutes: visitStay(a),
        dated: true,
        ...(end === null ? {} : { departureAt: end }),
      };
    }),
    legs,
    { notBefore: start + Math.round((initialTravelSeconds ?? 0) / 60), reachable: true, backfill: false },
  );
}

export function manualTravelMinutes(timing: DayTiming, from: string, to: string, mode: string): number | undefined {
  return timing.travel.find((leg) => leg.from === from && leg.to === to && leg.mode === mode)?.minutes;
}

export interface AppointmentTiming {
  id: number;
  type: string;
  status: string;
  reservation_time?: string | null;
  reservation_end_time?: string | null;
}

/** Compare local civil times; never reinterpret a reservation in the browser timezone. */
function appointmentMinute(value: string | null | undefined, date?: string | null): number | null {
  if (!value) return null;
  const match = /^(?:(\d{4}-\d{2}-\d{2})T)?([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  if (match[1] && !date) return null;
  const offset = match[1] && date ? (Date.parse(match[1]) - Date.parse(date)) / 86400000 : 0;
  return Number.isFinite(offset) ? offset * 1440 + Number(match[2]) * 60 + Number(match[3]) : null;
}

export function appointmentConflicts(
  bookings: AppointmentTiming[],
  arrival: number | null,
  departure: number | null,
  date?: string | null,
): number[] {
  return bookings
    .filter((b) => {
      if (b.status === 'cancelled' || !['restaurant', 'event', 'tour'].includes(b.type)) return false;
      const start = appointmentMinute(b.reservation_time, date);
      let end = appointmentMinute(b.reservation_end_time, date);
      if (start !== null && end !== null && !b.reservation_end_time?.includes('T') && end < start) end += 1440;
      return (
        (arrival !== null && start !== null && arrival > start) ||
        (departure !== null && end !== null && departure < end)
      );
    })
    .map((b) => b.id);
}
