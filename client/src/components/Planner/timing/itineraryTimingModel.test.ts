import { assignmentSchema } from '@trek/shared';
import { describe, expect, it } from 'vitest';
import type { MergedItem } from '../../../utils/dayMerge';
import { buildItineraryTiming } from './itineraryTimingModel';

const visit = (id: number, stay = 60): MergedItem => ({
  type: 'place',
  sortKey: id,
  data: assignmentSchema.parse({
    id,
    day_id: 1,
    place_id: id,
    order_index: id,
    stay_minutes: stay,
    place: { id, name: `Stop ${id}`, lat: id, lng: id },
  }),
});
const timing = {
  enabled: true,
  start: '09:00',
  travel: [{ from: 'assignment:1', to: 'assignment:2', mode: 'walking', minutes: 30 }],
};

describe('regular itinerary timing adapter', () => {
  it('uses exact manual legs without a map route and shifts later visits when stay changes', () => {
    const plan = buildItineraryTiming({
      items: [visit(1, 90), visit(2)],
      dayId: 1,
      timing: timing,
      segments: [],
      profile: 'walking',
    });
    expect(plan.schedule.entries.map((e) => e.arrival)).toEqual(['09:00', '11:00']);
    expect(
      buildItineraryTiming({
        items: [visit(1, 120), visit(2)],
        dayId: 1,
        timing: timing,
        segments: [],
        profile: 'walking',
      }).schedule.entries[1]?.arrival
    ).toBe('11:30');
    expect(
      buildItineraryTiming({ items: [visit(2), visit(1)], dayId: 1, timing: timing, segments: [], profile: 'walking' })
        .schedule.entries[1]?.arrival
    ).toBeNull();
    expect(
      buildItineraryTiming({ items: [visit(1), visit(2)], dayId: 1, timing: timing, segments: [], profile: 'driving' })
        .schedule.entries[1]?.arrival
    ).toBeNull();
  });
  it('leaves missing hotel travel unknown and carries midnight without moving a visit', () => {
    expect(
      buildItineraryTiming({
        items: [visit(1)],
        dayId: 1,
        timing: timing,
        segments: [],
        profile: 'walking',
        initialSeconds: null,
      }).schedule.entries[0]?.arrival
    ).toBeNull();
    const stop = visit(1, 90);
    const plan = buildItineraryTiming({
      items: [stop],
      dayId: 1,
      timing: { ...timing, start: '23:30' },
      segments: [],
      profile: 'walking',
    });
    expect(plan.schedule.entries[0]).toMatchObject({ arrival: '23:30', departure: '01:00', departureDayOffset: 1 });
    expect(stop.data.day_id).toBe(1);
  });
  it('keeps carrier timetables fixed and resumes from their arrival endpoint', () => {
    const transport: MergedItem = {
      type: 'transport',
      sortKey: 1,
      data: {
        id: 10,
        type: 'train',
        day_id: 1,
        reservation_time: '10:00',
        reservation_end_time: '12:00',
        endpoints: [
          { role: 'from', lat: 0, lng: 0 },
          { role: 'to', lat: 2, lng: 2 },
        ],
      },
    };
    const plan = buildItineraryTiming({
      items: [transport, visit(2)],
      dayId: 1,
      timing: timing,
      segments: [],
      profile: 'walking',
    });
    expect(plan.schedule.entries.map((e) => [e.arrival, e.departure])).toEqual([
      ['10:00', '12:00'],
      ['12:00', '13:00'],
    ]);
    expect(transport.data.reservation_time).toBe('10:00');
  });
});

it('resolves a manual hotel departure leg through the same route gates as the map', async () => {
  const { itineraryInitialTravel } = await import('./itineraryTimingModel');
  const { buildAssignment, buildDay, buildPlace } = await import('../../../../tests/helpers/factories');
  const stop = buildAssignment({ id: 2, day_id: 2, place: buildPlace({ lat: 48.86, lng: 2.35 }) });
  const input = {
    days: [1, 2, 3].map((id) =>
      buildDay({
        id,
        day_number: id,
        timing: {
          enabled: true,
          start: '09:00',
          travel: [{ from: 'hotel:48.8,2.3', to: 'point:48.86,2.35', mode: 'walking', minutes: 20 }],
        },
      })
    ),
    assignments: { '2': [stop] },
    reservations: [],
    optimizeFromAccommodation: true,
    accommodations: [
      { id: 1, trip_id: 1, place_id: 1, place_lat: 48.8, place_lng: 2.3, start_day_id: 1, end_day_id: 3 },
    ],
  };
  const leg = itineraryInitialTravel(2, input, [], 'walking');
  expect(leg).toMatchObject({ seconds: 1200, manual: 20 });
  expect(
    buildItineraryTiming({
      items: [{ type: 'place', sortKey: 0, data: stop }],
      dayId: 2,
      timing: input.days[1].timing!,
      segments: [],
      profile: 'walking',
      initialSeconds: leg,
    }).schedule.entries[0]?.arrival
  ).toBe('09:20');
  expect(itineraryInitialTravel(2, { ...input, optimizeFromAccommodation: false }, [], 'walking')).toBeUndefined();
  expect(itineraryInitialTravel(2, input, [], 'driving')?.seconds).toBeUndefined();
});

it.each(['car', 'bicycle', 'parking'])('does not consume the %s booking interval as a ride', (type) => {
  const booking: MergedItem = {
    type: 'transport',
    sortKey: 0,
    data: {
      id: 10,
      type,
      day_id: 1,
      reservation_time: '09:00',
      reservation_end_time: '18:00',
      endpoints: [
        { role: 'from', lat: 2, lng: 2 },
        { role: 'to', lat: 3, lng: 3 },
      ],
    },
  };
  const plan = buildItineraryTiming({
    items: [booking, visit(2)],
    dayId: 1,
    timing: timing,
    segments: [],
    profile: 'walking',
  });
  expect(plan.schedule.entries.map((e) => [e.arrival, e.departure])).toEqual([
    ['09:00', '09:00'],
    ['09:00', '10:00'],
  ]);
  expect(plan.nodes[0].to).toEqual({ lat: 2, lng: 2 });
  expect(booking.data.reservation_end_time).toBe('18:00');
});

it('uses the pickup and return handover points of a multiday rental', () => {
  const booking: MergedItem = {
    type: 'transport',
    sortKey: 0,
    data: {
      id: 10,
      type: 'car',
      day_id: 1,
      end_day_id: 2,
      reservation_time: '09:00',
      reservation_end_time: '18:00',
      endpoints: [
        { role: 'from', lat: 1, lng: 1 },
        { role: 'to', lat: 2, lng: 2 },
      ],
    },
  };
  expect(
    buildItineraryTiming({ items: [booking, visit(1)], dayId: 1, timing: timing, segments: [], profile: 'walking' })
      .schedule.entries[1].arrival
  ).toBe('09:00');
  expect(
    buildItineraryTiming({ items: [booking, visit(2)], dayId: 2, timing: timing, segments: [], profile: 'walking' })
      .schedule.entries[1].arrival
  ).toBe('18:00');
});

it.each(['restaurant', 'event', 'tour', 'train'])(
  'keeps a date-only %s booking from breaking known visit travel',
  (type) => {
    const booking: MergedItem = {
      type: 'transport',
      sortKey: 1.5,
      data: { id: 10, type, day_id: 1, reservation_time: '2099-06-01', reservation_end_time: null },
    };
    const plan = buildItineraryTiming({
      items: [visit(1), booking, visit(2)],
      dayId: 1,
      timing: timing,
      segments: [],
      profile: 'walking',
    });
    expect(plan.nodes.map((n) => n.key)).toEqual(['assignment:1', 'assignment:2']);
    expect(plan.schedule.entries[1].arrival).toBe('10:30');
  }
);

it('keeps an orphaned visit as an unknown gap without crashing timing', () => {
  const orphan = visit(3);
  orphan.data.place = null;
  const plan = buildItineraryTiming({
    items: [visit(1), orphan, visit(2)],
    dayId: 1,
    timing: timing,
    segments: [],
    profile: 'walking',
  });
  expect(plan.nodes.map((n) => n.key)).toEqual(['assignment:1', 'assignment:3', 'assignment:2']);
  expect(plan.schedule.entries.map((e) => e.arrival)).toEqual(['09:00', null, null]);
});
