import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tripRepo } from '../../repo/tripRepo';
import GuestIdentityTransferModal from './GuestIdentityTransferModal';

const impact = {
  expenses: 1,
  payments: 0,
  itinerary: 0,
  bookings: 0,
  todos: 0,
  packing: 0,
  ratings: 0,
  rating_overlaps: 0,
};
const guest = { guest_user_id: 19, name: 'Alex', impact, conflicts: [] };

afterEach(() => vi.restoreAllMocks());

describe('GuestIdentityTransferModal', () => {
  it('reads fresh candidates after reopening and when the trip changes', async () => {
    const list = vi
      .spyOn(tripRepo, 'guestIdentityTransferCandidates')
      .mockResolvedValueOnce({ candidates: [guest] })
      .mockResolvedValueOnce({ candidates: [{ ...guest, name: 'Sam' }] })
      .mockResolvedValueOnce({ candidates: [{ ...guest, name: 'Jo' }] });
    const onClose = vi.fn();
    const { rerender } = render(<GuestIdentityTransferModal open tripId={42} onClose={onClose} />);
    await screen.findByText('Alex');

    rerender(<GuestIdentityTransferModal open={false} tripId={42} onClose={onClose} />);
    rerender(<GuestIdentityTransferModal open tripId={42} onClose={onClose} />);
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
    await screen.findByText('Sam');

    rerender(<GuestIdentityTransferModal open tripId={43} onClose={onClose} />);
    expect(screen.queryByText('Sam')).not.toBeInTheDocument();
    await screen.findByText('Jo');
    expect(list.mock.calls).toEqual([[42], [42], [43]]);
  });

  it('writes one transfer while the request is pending and closes on success', async () => {
    const transfer = vi
      .spyOn(tripRepo, 'transferGuestIdentity')
      .mockResolvedValue({ success: true, transferred_guest_user_id: guest.guest_user_id, impact });
    const onClose = vi.fn();
    render(<GuestIdentityTransferModal open tripId={42} candidates={[guest]} onClose={onClose} />);
    const claim = screen.getByRole('button', { name: 'members.identityTransfer.thisIsMe' });
    await act(async () => {
      fireEvent.click(claim);
      fireEvent.click(claim);
    });
    expect(transfer).toHaveBeenCalledExactlyOnceWith(42, guest.guest_user_id);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
