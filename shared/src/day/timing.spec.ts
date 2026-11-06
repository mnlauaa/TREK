import { assignmentSchema, assignmentStayRequestSchema } from '../assignment/assignment.schema';
import { dayTimingRequestSchema } from './day.schema';
import { appointmentConflicts, itinerarySchedule, manualTravelMinutes, visitStay, visitTimes } from './timing';

import { describe, expect, it } from 'vitest';

const visit = (id: number, start: string | null = null, end: string | null = null, stay = 60) =>
  assignmentSchema.parse({
    id,
    place_id: id,
    day_id: 1,
    order_index: id,
    assignment_time: start,
    assignment_end_time: end,
    stay_minutes: stay,
    place: { id, name: 'Stop', place_time: null, end_time: null },
  });
const timing = { enabled: true, start: '09:00', travel: [] };

describe('itinerary predictions', () => {
  it('uses travel and stay, waits for Start, and derives stay from End', () => {
    const stops = [visit(1), visit(2, '11:00', null, 30), visit(3, null, '14:00', 5), visit(4, '15:00', '16:00', 5)];
    const before = JSON.stringify(stops);
    const result = itinerarySchedule(stops, [1800, 1800, 1800], timing);
    expect(result.entries.map((e) => [e.arrival, e.departure])).toEqual([
      ['09:00', '10:00'],
      ['11:00', '11:30'],
      ['12:00', '14:00'],
      ['15:00', '16:00'],
    ]);
    expect(JSON.stringify(stops)).toBe(before);
  });
  it('retains fixed inputs while carrying reachable times through missed appointments', () => {
    const stops = [visit(1, '13:30', null, 0), visit(2, null, '14:00'), visit(3, '14:00', null, 30)];
    const result = itinerarySchedule(stops, [3600, 1800], timing);
    expect(result.entries[1]).toMatchObject({ arrival: '14:30', departure: '14:30', plannedDeparture: '14:00' });
    expect(result.entries[2]).toMatchObject({ arrival: '15:00', departure: '15:30', plannedArrival: '14:00' });
    expect(result.warnings.map((w) => w.code)).toEqual(['missedLeave', 'late']);
    expect(stops[1]!.assignment_end_time).toBe('14:00');
  });
  it('keeps missing travel unknown until a fixed time and preserves midnight carry', () => {
    const missing = itinerarySchedule([visit(1), visit(2), visit(3, '15:00')], [undefined, 600], timing);
    expect(missing.entries[1]!.arrival).toBeNull();
    expect(missing.entries[2]!.arrival).toBe('15:00');
    const overnight = itinerarySchedule([visit(1, '23:30', null, 90), visit(2, null, null, 0)], [1800], timing);
    expect(overnight.entries[0]).toMatchObject({ departure: '01:00', departureDayOffset: 1 });
    expect(overnight.entries[1]).toMatchObject({ arrival: '01:30', dayOffset: 1 });
  });
  it('does not turn a missed fixed End into tomorrow or invent departure across unknown travel', () => {
    const result = itinerarySchedule([visit(1, '23:30', null, 180), visit(2, null, '14:00')], [0], timing);
    expect(result.entries[1]).toMatchObject({
      arrival: '02:30',
      departure: '02:30',
      dayOffset: 1,
      departureDayOffset: 1,
      plannedDeparture: '14:00',
    });
    expect(result.warnings.some((w) => w.code === 'missedLeave')).toBe(true);
    const unknown = itinerarySchedule([visit(1), visit(2, null, '14:00'), visit(3)], [undefined, 0], timing);
    expect(unknown.entries[1]).toMatchObject({ arrival: null, departure: null });
    expect(unknown.entries[2]!.arrival).toBeNull();
  });
  it('keeps visit defaults and explicit clears independent', () => {
    const a = visit(1);
    a.place.duration_minutes = 45;
    a.stay_minutes = null;
    a.place.place_time = '10:00';
    expect(visitStay(a)).toBe(45);
    expect(visitTimes(a).start).toBe('10:00');
    a.times_explicit = true;
    a.stay_minutes = 0;
    expect(visitTimes(a).start).toBeNull();
    expect(visitStay(a)).toBe(0);
  });
  it('matches overrides by both endpoints and mode and validates boundaries', () => {
    const setting = { ...timing, travel: [{ from: 'assignment:1', to: 'assignment:2', mode: 'walking', minutes: 0 }] };
    expect(manualTravelMinutes(setting, 'assignment:1', 'assignment:2', 'walking')).toBe(0);
    expect(manualTravelMinutes(setting, 'assignment:1', 'assignment:3', 'walking')).toBeUndefined();
    expect(manualTravelMinutes(setting, 'assignment:1', 'assignment:2', 'driving')).toBeUndefined();
    expect(dayTimingRequestSchema.safeParse({ ...setting, start: '25:00' }).success).toBe(false);
    expect(assignmentStayRequestSchema.safeParse({ stay_minutes: -1 }).success).toBe(false);
  });
  it('warns for each appointment without treating parking or cancelled bookings as appointments', () => {
    const bookings = ['restaurant', 'event', 'parking', 'tour'].map((type, i) => ({
      id: i,
      type,
      status: i === 3 ? 'cancelled' : 'confirmed',
      reservation_time: '18:00',
      reservation_end_time: '19:30',
    }));
    expect(appointmentConflicts(bookings, 17 * 60 + 45, 19 * 60 + 15)).toEqual([0, 1]);
    expect(
      appointmentConflicts(
        [{ ...bookings[0]!, reservation_time: '2026-10-06', reservation_end_time: null }],
        1000,
        1100,
      ),
    ).toEqual([]);
  });
});
