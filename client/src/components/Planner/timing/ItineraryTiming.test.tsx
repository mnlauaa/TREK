import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../../../../tests/helpers/render'
import { assignmentSchema, daySchema } from '@trek/shared'
import { useTripStore } from '../../../store/tripStore'
import { useSettingsStore } from '../../../store/settingsStore'
import { resetAllStores } from '../../../../tests/helpers/store'
import { VisitTiming } from './ItineraryTiming'
import { buildItineraryTiming } from './itineraryTimingModel'

const day = daySchema.parse({ id: 1, trip_id: 1, day_number: 1, timing: { enabled: true, start: '17:45', travel: [] } })
const visit = assignmentSchema.parse({ id: 2, day_id: 1, place_id: 3, order_index: 0, stay_minutes: 90, place: { id: 3, name: 'Dinner' } })
beforeEach(() => { resetAllStores(); useSettingsStore.setState({ settings: { time_format: '24h' } as never }) })
const open = (assignment = visit) => render(<VisitTiming assignment={assignment} day={day} tripId={1} editable bookings={[]} plan={buildItineraryTiming([{ type: 'place', data: assignment, sortKey: 0 }], 1, day.timing!, [], 'walking')} />)

describe('compact visit timing', () => {
  it('reveals fixed controls only when requested and reuses the duration editor', () => {
    open()
    expect(screen.getByText(/19:15/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Set fixed times/i }))
    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Time at this stop.*1 h 30/ }))
    expect(screen.getByRole('slider')).toHaveValue('90')
  })
  it('formats predictions using the selected 12-hour clock', () => {
    useSettingsStore.setState({ settings: { time_format: '12h' } as never })
    open()
    expect(screen.getByText(/Estimated departure.*7:15\s*PM/i)).toBeInTheDocument()
  })
  it('keeps stay read-only with End and preserves it when clearing that visit time', async () => {
    const setTimes = vi.fn(async () => undefined)
    useTripStore.setState({ setAssignmentTimes: setTimes })
    open({ ...visit, times_explicit: true, assignment_end_time: '19:30' })
    expect(screen.queryByRole('button', { name: /Time at this stop/ })).not.toBeInTheDocument()
    const end = screen.getByLabelText('End')
    fireEvent.change(end, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(setTimes).toHaveBeenCalledWith(1, 1, 2, { place_time: null, end_time: null }))
    expect(visit.stay_minutes).toBe(90)
  })
})
