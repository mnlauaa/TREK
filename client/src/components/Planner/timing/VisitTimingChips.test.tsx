import { assignmentSchema, daySchema } from '@trek/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../tests/helpers/render';
import { resetAllStores } from '../../../../tests/helpers/store';
import { useSettingsStore } from '../../../store/settingsStore';
import type { StayDraft } from '../../Roadtrip/RoadtripStayModal';
import { buildItineraryTiming } from './itineraryTimingModel';
import { VisitTimingChips } from './VisitTimingChips';

const timing = { enabled: true, start: '09:00', travel: [] };
const day = daySchema.parse({
  id: 1,
  trip_id: 1,
  day_number: 1,
  timing,
});
const visit = assignmentSchema.parse({
  id: 2,
  day_id: 1,
  place_id: 3,
  order_index: 0,
  stay_minutes: 60,
  place: { id: 3, name: 'PMQ' },
});
beforeEach(() => {
  resetAllStores();
  useSettingsStore.setState({ settings: { time_format: '24h' } as never });
});
function open(assignment = visit, onStay?: (draft: StayDraft) => void) {
  const plan = buildItineraryTiming({
    items: [{ type: 'place', data: assignment, sortKey: 0 }],
    dayId: 1,
    timing,
    segments: [],
    profile: 'walking',
  });
  return render(<VisitTimingChips assignment={assignment} day={day} tripId={1} plan={plan} editable onStay={onStay} />);
}
describe('Option A visit chips', () => {
  it('shows one time range and reuses the upstream stay dialog', () => {
    open();
    expect(screen.getByText('09:00–10:00')).toBeInTheDocument();
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Time at this stop/ }));
    expect(screen.getByRole('slider')).toHaveValue('60');
  });
  it('hands the selected visit and predicted arrival to the mobile sheet', () => {
    const onStay = vi.fn();
    open(visit, onStay);
    fireEvent.click(screen.getByRole('button', { name: /Time at this stop/ }));
    expect(onStay).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: 2,
        dayId: 1,
        placeId: 3,
        minutes: 60,
        arrival: '09:00',
        departure: '10:00',
      })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('makes a fixed End stay read-only and retains the saved duration', () => {
    open({ ...visit, times_explicit: true, assignment_end_time: '09:30' });
    expect(screen.getByText('09:00–09:30')).toBeInTheDocument();
    expect(screen.getByText('Stay 30 min')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Time at this stop/ })).not.toBeInTheDocument();
    expect(visit.stay_minutes).toBe(60);
  });
  it('shows reachable times and a numeric warning without changing the fixed start', () => {
    const fixed = { ...visit, times_explicit: true, assignment_time: '08:15' };
    open(fixed);
    expect(screen.getByText('09:00–10:00')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Arrives 45 min after the time you set');
    expect(fixed.assignment_time).toBe('08:15');
  });
  it('removes only the fixed End label when End is cleared', () => {
    const fixed = { ...visit, times_explicit: true, assignment_time: '10:00', assignment_end_time: '11:00' };
    const view = open(fixed);
    expect(screen.getByText('Fixed start 10:00')).toBeInTheDocument();
    expect(screen.getByText('Fixed end 11:00')).toBeInTheDocument();
    view.unmount();
    open({ ...fixed, assignment_end_time: null });
    expect(screen.getByText('Fixed start 10:00')).toBeInTheDocument();
    expect(screen.queryByText('Fixed end 11:00')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Time at this stop/ })).toBeInTheDocument();
  });
  it('shows only one warning when both fixed times conflict', () => {
    open({ ...visit, times_explicit: true, assignment_time: '08:15', assignment_end_time: '08:30' });
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
  it('uses the selected 12-hour display', () => {
    useSettingsStore.setState({ settings: { time_format: '12h' } as never });
    open();
    expect(screen.getByText(/9:00\s*AM–10:00\s*AM/)).toBeInTheDocument();
  });
});
