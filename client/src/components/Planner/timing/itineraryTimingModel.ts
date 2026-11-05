import { manualTravelMinutes, visitStay, visitTimes, type DayTiming } from '@trek/shared'
import { computeSchedule, parseClock, type ScheduleStop } from '@trek/shared/roadtrip'
import { getSpanPhase, getTransportRouteEndpoints, type MergedItem } from '../../../utils/dayMerge'
import { resolveLegMode } from '../legMode'
import { buildDayRouteRuns, type DayRouteInputs } from '../../Map/dayRoutePlan'
import type { Assignment, Reservation, RouteSegment } from '../../../types'

interface TimingLeg { from: string; to: string; mode: string; manual: number | undefined; seconds: number | undefined }

type Point = { lat: number; lng: number } | null
export interface TimingNode {
  key: string
  assignment?: Assignment
  from: Point
  to: Point
  stop: ScheduleStop
}
const clock = (value?: string | null) => value?.includes('T') ? value.split('T')[1]?.slice(0, 5) ?? null : value ?? null
const point = (p?: { lat?: number | null; lng?: number | null }): Point => p?.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null
const rideTypes = new Set(['flight', 'train', 'bus', 'taxi', 'cruise', 'ferry', 'transit', 'transport_other'])
const vehicleTypes = new Set(['car', 'bicycle', 'parking'])
const matches = (p: Point, c: [number, number]) => p !== null && Math.abs(p.lat - c[0]) < 1e-7 && Math.abs(p.lng - c[1]) < 1e-7

export function buildItineraryTiming(items: MergedItem[], dayId: number, timing: DayTiming, segments: RouteSegment[], profile: string, initialSeconds?: number | null | TimingLeg) {
  const nodes: TimingNode[] = []
  for (const item of items) {
    if (item.type === 'note') continue
    if (item.type === 'place') {
      const assignment = item.data as Assignment
      if (!assignment.place) {
        // Keep a broken/orphaned visit as an unknown route gap, without crashing the day.
        nodes.push({ key: `assignment:${assignment.id}`, assignment, from: null, to: null, stop: { anchor: null, dwellMinutes: 0 } })
        continue
      }
      const times = visitTimes(assignment)
      const end = parseClock(times.end)
      nodes.push({ key: `assignment:${assignment.id}`, assignment, from: point(assignment.place), to: point(assignment.place),
        stop: { anchor: times.start, dwellMinutes: visitStay(assignment), dated: true, ...(end === null ? {} : { departureAt: end }) } })
    } else {
      const reservation = item.data as Reservation & { __leg?: { index: number } }
      if (reservation.status === 'cancelled' || (!rideTypes.has(reservation.type) && !vehicleTypes.has(reservation.type))) continue
      const phase = getSpanPhase(reservation, dayId)
      if (phase === 'middle') continue
      const endpoints = getTransportRouteEndpoints(reservation, dayId)
      const start = clock(phase === 'end' ? reservation.reservation_end_time : reservation.reservation_time)
      const end = parseClock(clock(reservation.reservation_end_time))
      // Date-only/ambiguous bookings remain context, not clock anchors or route breaks.
      if (parseClock(start) === null && end === null) continue
      const key = `reservation:${reservation.id}:${phase}:${reservation.__leg?.index ?? 0}`
      if (vehicleTypes.has(reservation.type)) {
        // A rental or parking interval is possession of a vehicle, not time spent
        // riding it. This row is the handover at its displayed start/end endpoint.
        // A same-day return stays a booking detail rather than consuming the day.
        const handover = phase === 'end' ? endpoints.to : endpoints.from
        if (parseClock(start) === null || handover === null) continue
        nodes.push({ key, from: handover, to: handover,
          stop: { anchor: start, dwellMinutes: 0, dated: true } })
      } else {
        nodes.push({ key, from: endpoints.from, to: endpoints.to,
          stop: { anchor: start, dwellMinutes: 0, dated: true, timetable: true,
            ...(end === null || phase === 'start' ? {} : { departureAt: end }) } })
      }
    }
  }
  const legs = nodes.slice(0, -1).map((node, i) => {
    const next = nodes[i + 1]!
    const mode = node.assignment?.leg_transport_mode ?? (!node.assignment ? next.assignment?.incoming_leg_transport_mode : null) ?? profile
    const manual = manualTravelMinutes(timing, node.key, next.key, mode)
    const segment = segments.find(s => matches(node.to, s.from) && matches(next.from, s.to) && (!s.mode || s.mode === mode))
    const stationary = node.to && next.from && matches(node.to, [next.from.lat, next.from.lng])
    return { from: node.key, to: next.key, mode, manual, seconds: manual !== undefined ? manual * 60 : stationary ? 0 : segment?.duration }
  })
  const initialLeg = typeof initialSeconds === 'object' && initialSeconds !== null ? initialSeconds : undefined
  const initial = initialLeg ? initialLeg.seconds ?? null : initialSeconds as number | null | undefined
  const schedule = computeSchedule(nodes.map(n => n.stop), legs.map(l => l.seconds), {
    notBefore: initial === null ? null : parseClock(timing.start)! + Math.round((initial ?? 0) / 60), reachable: true, backfill: false,
  })
  return { nodes, legs: initialLeg ? [initialLeg, ...legs] : legs, schedule }
}

/** Use the route builder's hotel gates, even while its estimate is unavailable. */
export function itineraryInitialTravel(dayId: number, input: DayRouteInputs, segments: RouteSegment[], profile = 'driving'): TimingLeg | undefined {
  const run = buildDayRouteRuns(dayId, input).find(run => run[0]?.hotel === 'morning' && run.length > 1)
  if (!run) return undefined
  const [origin, target] = run
  const day = input.days.find(d => d.id === dayId)
  const from = `hotel:${origin!.lat},${origin!.lng}`
  const to = `point:${target!.lat},${target!.lng}`
  const mode = resolveLegMode(origin!, target!, day?.default_transport_mode ?? profile)
  const manual = day?.timing ? manualTravelMinutes(day.timing, from, to, mode) : undefined
  const segment = segments.find(s => s.hotelBookend === 'morning' && matches(origin!, s.from) && matches(target!, s.to) && (!s.mode || s.mode === mode))
  return { from, to, mode, manual, seconds: manual !== undefined ? manual * 60 : segment?.duration }
}

export const defaultDayTiming = (): DayTiming => ({ enabled: false, start: '09:00', travel: [] })
