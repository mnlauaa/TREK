import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { buildTrip, buildUser } from '../../../tests/helpers/factories';
import { server } from '../../../tests/helpers/msw/server';
import { act, render, screen, waitFor } from '../../../tests/helpers/render';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { guestIdentityRepo } from '../../repo/guestIdentityRepo';
import { useAuthStore } from '../../store/authStore';
import { useTripStore } from '../../store/tripStore';
import GuestIdentityTransferModal, { NewMemberIdentityCheck } from './GuestIdentityTransferModal';

const candidate = {
  guest_user_id: 3,
  name: 'Guest Sam',
  conflicts: [],
  impact: { expenses: 1, payments: 2, itinerary: 0, bookings: 0, todos: 0, packing: 0, ratings: 0, rating_overlaps: 0 },
};
const checkPath = '/api/trips/1/new-member-identity-check';

beforeEach(() => {
  resetAllStores();
  seedStore(useAuthStore, { user: buildUser({ id: 2 }), isAuthenticated: true });
  seedStore(useTripStore, { trip: buildTrip({ id: 1, user_id: 1 }) });
  server.use(http.post(checkPath, () => HttpResponse.json({ required: true, candidates: [candidate] })));
});

it('shows a failed identity check and lets the new member retry it', async () => {
  const user = userEvent.setup();
  let attempts = 0;
  server.use(
    http.post(checkPath, () => {
      attempts++;
      return attempts === 1
        ? HttpResponse.json({ error: 'Temporarily unavailable' }, { status: 503 })
        : HttpResponse.json({ required: true, candidates: [candidate] });
    })
  );
  render(<NewMemberIdentityCheck tripId={1} />);
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Guest Sam')).toBeVisible();
  expect(attempts).toBe(2);
});

it('keeps the popup open when declining fails and closes only after a saved decline', async () => {
  const user = userEvent.setup();
  let attempts = 0;
  server.use(
    http.post(`${checkPath}/decline`, () => {
      attempts++;
      return attempts === 1
        ? HttpResponse.json({ error: 'Temporarily unavailable' }, { status: 503 })
        : HttpResponse.json({ success: true });
    })
  );
  render(<NewMemberIdentityCheck tripId={1} />);
  const decline = await screen.findByRole('button', { name: 'None of these are me' });
  await user.click(decline);
  await waitFor(() => expect(attempts).toBe(1));
  expect(screen.getByRole('dialog', { name: 'Does a Guest represent you?' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'None of these are me' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(attempts).toBe(2);
});

it('treats a completed forbidden check as ineligible rather than a retryable failure', async () => {
  const read = vi.spyOn(guestIdentityRepo, 'read');
  server.use(
    http.post(checkPath, () =>
      HttpResponse.json(
        {
          error: 'Only non-owner account members can transfer Guest identities',
          code: 'GUEST_IDENTITY_TRANSFER_FORBIDDEN',
        },
        { status: 403 }
      )
    )
  );
  render(<NewMemberIdentityCheck tripId={1} />);
  await waitFor(() => expect(read).toHaveBeenCalled());
  await act(async () => {
    expect(await read.mock.results[0].value).toBeNull();
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  read.mockRestore();
});

it('keeps the chosen guest available when a transfer fails', async () => {
  const user = userEvent.setup();
  server.use(
    http.post('/api/trips/1/guests/3/identity-transfer', () =>
      HttpResponse.json({ error: 'Please resolve the financial conflict' }, { status: 409 })
    )
  );
  render(<NewMemberIdentityCheck tripId={1} />);
  await user.click(await screen.findByRole('button', { name: 'This is me' }));
  expect(await screen.findByText('Please resolve the financial conflict')).toBeVisible();
  expect(screen.getByRole('button', { name: 'This is me' })).toBeEnabled();
  expect(screen.getByText('Guest Sam')).toBeVisible();
});

it('shows a retryable error for a manual candidate request rather than claiming no guests exist', async () => {
  const user = userEvent.setup();
  let attempts = 0;
  server.use(
    http.get('/api/trips/1/guest-identity-transfers/candidates', () => {
      attempts++;
      return attempts === 1
        ? HttpResponse.json({ error: 'Temporarily unavailable' }, { status: 503 })
        : HttpResponse.json({ candidates: [candidate] });
    })
  );
  render(<GuestIdentityTransferModal tripId={1} open onClose={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Guest Sam')).toBeVisible();
});

it('allows only one decision while a transfer is pending', async () => {
  const user = userEvent.setup();
  let finish: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let transfers = 0;
  server.use(
    http.post('/api/trips/1/guests/3/identity-transfer', async () => {
      transfers++;
      await pending;
      return HttpResponse.json({ error: 'Try later' }, { status: 503 });
    })
  );
  render(<NewMemberIdentityCheck tripId={1} />);
  await user.click(await screen.findByRole('button', { name: 'This is me' }));
  await waitFor(() => expect(transfers).toBe(1));
  expect(screen.getByRole('button', { name: 'This is me' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'None of these are me' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  finish!();
  expect(await screen.findByText('Try later')).toBeVisible();
  expect(screen.getByRole('button', { name: 'This is me' })).toBeEnabled();
});

it('does not request an identity check for the trip owner', () => {
  const read = vi.spyOn(guestIdentityRepo, 'read');
  seedStore(useAuthStore, { user: buildUser({ id: 1 }), isAuthenticated: true });
  render(<NewMemberIdentityCheck tripId={1} />);
  expect(read).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  read.mockRestore();
});
