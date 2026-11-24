import type { TimingPlan } from '../Planner/timing/ItineraryTiming';

export function pdfTimingChip(
  plan: TimingPlan | undefined,
  assignmentId: number,
  format: {
    clock: (value: string | null) => string;
    translate: (key: string, params?: Record<string, string | number>) => string;
    escape: (value: string) => string;
  }
): string {
  const index = plan?.nodes.findIndex((node) => node.assignment?.id === assignmentId) ?? -1;
  const entry = plan?.schedule.entries[index];
  if (!entry) return '';
  const { clock, translate: t, escape } = format;
  const time = (value: string | null, offset: number) =>
    value ? `${clock(value)}${offset ? ` ${t('timing.dayOffset', { count: offset })}` : ''}` : t('timing.unknown');
  return `<span class="chip">${escape(t('timing.arrival'))} ${escape(time(entry.arrival, entry.dayOffset))} · ${escape(t('timing.departure'))} ${escape(time(entry.departure, entry.departureDayOffset ?? entry.dayOffset))}</span>`;
}
