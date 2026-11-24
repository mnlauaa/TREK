import { dayTimingRequestSchema } from '@trek/shared';

export function copyDayTiming(
  json: string,
  assignments: ReadonlyMap<number, number>,
  reservations: ReadonlyMap<number, number>,
): string {
  const timing = dayTimingRequestSchema.parse(JSON.parse(json));
  const remap = (key: string): string | null => {
    const [kind, id, ...suffix] = key.split(':');
    if (kind === 'hotel' || kind === 'point') return key;
    const next =
      kind === 'assignment'
        ? assignments.get(Number(id))
        : kind === 'reservation'
          ? reservations.get(Number(id))
          : undefined;
    return next === undefined ? null : [kind, String(next), ...suffix].join(':');
  };
  timing.travel = timing.travel.flatMap((leg) => {
    const from = remap(leg.from),
      to = remap(leg.to);
    return from && to ? [{ ...leg, from, to }] : [];
  });
  return JSON.stringify(timing);
}
