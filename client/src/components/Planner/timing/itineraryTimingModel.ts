import { manualTravelMinutes, visitStay, visitTimes, type DayTiming } from '@trek/shared';
import { computeSchedule, parseClock, type ScheduleStop } from '@trek/shared/roadtrip';
import type { Assignment, Day, Reservation, RouteSegment } from '../../../types';
import { getSpanPhase, getTransportRouteEndpoints, type MergedItem } from '../../../utils/dayMerge';
import { buildDayRouteRuns, type DayRouteInputs } from '../../Map/dayRoutePlan';
import { projectedById, type DayItineraryItem } from '../../Map/dayTourProjection';
import { resolveLegMode } from '../legMode';

interface TimingLeg {
  from: string;
  to: string;
  mode: string;
  manual: number | undefined;
  seconds: number | undefined;
}

type Point = { lat: number; lng: number } | null;
export interface TimingNode {
  key: string;
  assignment?: Assignment;
  from: Point;
  to: Point;
  stop: ScheduleStop;
}
const clock = (value?: string | null) =>
  value?.includes('T') ? (value.split('T')[1]?.slice(0, 5) ?? null) : (value ?? null);
const point = (p?: { lat?: number | null; lng?: number | null }): Point =>
  p?.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null;
const rideTypes = new Set(['flight', 'train', 'bus', 'taxi', 'cruise', 'ferry', 'transit', 'transport_other']);
const vehicleTypes = new Set(['car', 'bicycle', 'parking']);
const matches = (p: Point, c: [number, number]) =>
  p !== null && Math.abs(p.lat - c[0]) < 1e-7 && Math.abs(p.lng - c[1]) < 1e-7;

export function buildItineraryTiming({
  items,
  dayId,
  timing,
  segments,
  profile,
  initialSeconds,
  routeContext,
}: {
  items: MergedItem[];
  dayId: number;
  timing: DayTiming;
  segments: RouteSegment[];
  profile: string;
  initialSeconds?: number | null | TimingLeg;
  routeContext?: Pick<DayRouteInputs, 'places' | 'toursEnabled' | 'tourStageStops'>;
}) {
  const nodes: TimingNode[] = [];
  const visits = items.filter((item) => item.type === 'place').map((item) => item.data as Assignment);
  const projected = projectedById(
    visits,
    routeContext?.toursEnabled ?? true,
    routeContext?.places,
    routeContext?.tourStageStops
  );
  for (const item of items) {
    const node = itineraryNode(item, dayId, item.type === 'place' ? projected.get(item.data.id) : undefined);
    if (node) nodes.push(node);
  }
  const legs = nodes.slice(0, -1).map((node, i) => {
    const next = nodes[i + 1];
    if (!next) throw new Error('Missing next timing stop');
    const mode =
      node.assignment?.leg_transport_mode ??
      (!node.assignment ? next.assignment?.incoming_leg_transport_mode : null) ??
      profile;
    const manual = manualTravelMinutes(timing, node.key, next.key, mode);
    const segment = segments.find(
      (s) => matches(node.to, s.from) && matches(next.from, s.to) && (!s.mode || s.mode === mode)
    );
    const stationary = node.to && next.from && matches(node.to, [next.from.lat, next.from.lng]);
    return {
      from: node.key,
      to: next.key,
      mode,
      manual,
      seconds: manual !== undefined ? manual * 60 : stationary ? 0 : segment?.duration,
    };
  });
  const initialLeg = typeof initialSeconds === 'object' && initialSeconds !== null ? initialSeconds : undefined;
  const initial = initialLeg ? (initialLeg.seconds ?? null) : (initialSeconds as number | null | undefined);
  const schedule = computeSchedule(
    nodes.map((n) => n.stop),
    legs.map((l) => l.seconds),
    {
      notBefore: initial === null ? null : (parseClock(timing.start) ?? 0) + Math.round((initial ?? 0) / 60),
      reachable: true,
      backfill: false,
    }
  );
  return { nodes, legs: initialLeg ? [initialLeg, ...legs] : legs, schedule };
}

/** Use the route builder's hotel gates, even while its estimate is unavailable. */
export function itineraryInitialTravel(
  dayId: number,
  input: DayRouteInputs,
  segments: RouteSegment[],
  profile = 'driving'
): TimingLeg | undefined {
  const run = buildDayRouteRuns(dayId, input).find((run) => run[0]?.hotel === 'morning' && run.length > 1);
  if (!run) return undefined;
  const [origin, target] = run;
  if (!origin || !target) return undefined;
  const day = input.days.find((d) => d.id === dayId);
  const from = `hotel:${origin.lat},${origin.lng}`;
  const to = `point:${target.lat},${target.lng}`;
  const mode = resolveLegMode(origin, target, day?.default_transport_mode ?? profile);
  const manual = day?.timing ? manualTravelMinutes(day.timing, from, to, mode) : undefined;
  const segment = segments.find(
    (s) =>
      s.hotelBookend === 'morning' && matches(origin, s.from) && matches(target, s.to) && (!s.mode || s.mode === mode)
  );
  return { from, to, mode, manual, seconds: manual !== undefined ? manual * 60 : segment?.duration };
}

export const defaultDayTiming = (): DayTiming => ({ enabled: false, start: '09:00', travel: [] });

function itineraryNode(item: MergedItem, dayId: number, projection?: DayItineraryItem): TimingNode | null {
  if (item.type === 'note') return null;
  if (item.type === 'place') {
    return assignmentNode(item.data as Assignment, projection);
  } else {
    const reservation = item.data as Reservation & { __leg?: { index: number } };
    if (reservation.status === 'cancelled' || (!rideTypes.has(reservation.type) && !vehicleTypes.has(reservation.type)))
      return null;
    const phase = getSpanPhase(reservation, dayId);
    if (phase === 'middle') return null;
    const endpoints = getTransportRouteEndpoints(reservation, dayId);
    const start = clock(phase === 'end' ? reservation.reservation_end_time : reservation.reservation_time);
    const end = parseClock(clock(reservation.reservation_end_time));
    if (parseClock(start) === null && end === null) return null;
    const key = `reservation:${reservation.id}:${phase}:${reservation.__leg?.index ?? 0}`;
    if (vehicleTypes.has(reservation.type)) {
      const handover = phase === 'end' ? endpoints.to : endpoints.from;
      if (parseClock(start) === null || handover === null) return null;
      return { key, from: handover, to: handover, stop: { anchor: start, dwellMinutes: 0, dated: true } };
    } else {
      return {
        key,
        from: endpoints.from,
        to: endpoints.to,
        stop: {
          anchor: start,
          dwellMinutes: 0,
          dated: true,
          timetable: true,
          ...(end === null || phase === 'start' ? {} : { departureAt: end }),
        },
      };
    }
  }
}

export function dayTimingPlan(
  day: Day,
  items: MergedItem[],
  input: DayRouteInputs,
  routes: {
    segments: Record<number, RouteSegment>;
    hotel?: RouteSegment;
    profile: string;
  }
) {
  if (!day.timing?.enabled) return undefined;
  const segments = Object.values(routes.segments);
  const initialSegments = routes.hotel ? [...segments, routes.hotel] : segments;
  return buildItineraryTiming({
    items,
    dayId: day.id,
    timing: day.timing,
    segments,
    profile: day.default_transport_mode ?? routes.profile,
    routeContext: input,
    initialSeconds: itineraryInitialTravel(day.id, input, initialSegments, routes.profile),
  });
}

function assignmentNode(assignment: Assignment, projection?: DayItineraryItem): TimingNode | null {
  if (assignment.route_excluded) return null;
  if (!assignment.place) {
    return {
      key: `assignment:${assignment.id}`,
      assignment,
      from: null,
      to: null,
      stop: { anchor: null, dwellMinutes: 0 },
    };
  }
  const times = visitTimes(assignment);
  const end = parseClock(times.end);
  return {
    key: `assignment:${assignment.id}`,
    assignment,
    from: projection?.kind === 'tour' ? projection.start : point(assignment.place),
    to: projection?.kind === 'tour' ? projection.end : point(assignment.place),
    stop: {
      anchor: times.start,
      dwellMinutes: visitStay(assignment),
      dated: true,
      ...(end === null ? {} : { departureAt: end }),
    },
  };
}
