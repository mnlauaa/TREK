import type { GuestIdentityTransferCandidate } from '@trek/shared';
import { UserRound } from 'lucide-react';
import React, { useId } from 'react';
import { DialogButton, DialogFooter, DialogHeader, DialogShell, DialogTile, NEUTRAL_TINT } from '../shared/DialogShell';

import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useTripStore } from '../../store/tripStore';
import { useToast } from '../shared/Toast';
import { useGuestIdentityCheck } from './useGuestIdentityCheck';

interface TransferDialogProps {
  tripId: number | string;
  candidates?: GuestIdentityTransferCandidate[];
  onClose: () => void;
  onTransferred?: () => void;
  source?: 'manual' | 'new-member';
}

export default function GuestIdentityTransferModal({
  open,
  ...props
}: TransferDialogProps & { open: boolean }): React.ReactElement | null {
  const accountId = useAuthStore((state) => state.user?.id);
  return open ? <TransferDialog key={`${props.tripId}:${accountId}`} {...props} accountId={accountId} /> : null;
}

function TransferDialog({
  tripId,
  candidates: initialCandidates,
  onClose,
  onTransferred,
  source = 'manual',
  accountId,
}: TransferDialogProps & { accountId?: number }): React.ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const labelId = useId();
  const { state, check, close, decide } = useGuestIdentityCheck({
    tripId: Number(tripId),
    accountId,
    source,
    initialCandidates,
    onClose,
    onTransferred: () => {
      toast.success(t('members.identityTransfer.success'));
      onTransferred?.();
    },
  });
  if (state.phase === 'hidden' || (state.phase === 'checking' && !state.visible)) return null;
  const busy = state.phase === 'submitting';
  const candidates = 'candidates' in state ? state.candidates : null;

  const impacts = (candidate: GuestIdentityTransferCandidate) =>
    [
      ['expenses', candidate.impact.expenses],
      ['payments', candidate.impact.payments],
      ['itinerary', candidate.impact.itinerary],
      ['bookings', candidate.impact.bookings],
      ['todos', candidate.impact.todos],
      ['packing', candidate.impact.packing],
      ['ratings', candidate.impact.ratings],
    ] as const;

  return (
    <DialogShell
      onClose={close}
      labelledBy={labelId}
      blocked={busy}
      header={
        <DialogHeader
          labelId={labelId}
          onClose={close}
          title={t('members.identityTransfer.title')}
          sub={t('members.identityTransfer.description')}
          tint={NEUTRAL_TINT}
          tile={
            <DialogTile>
              <UserRound size={20} />
            </DialogTile>
          }
        />
      }
      footer={
        source === 'new-member' &&
        candidates && (
          <DialogFooter>
            <DialogButton
              disabled={busy}
              onClick={() => {
                void decide({ kind: 'decline' });
              }}
            >
              {t('members.identityTransfer.noneOfThese')}
            </DialogButton>
          </DialogFooter>
        )
      }
    >
      <div className="space-y-3">
        {'error' in state && (
          <p role="alert" className="text-danger">
            {t('members.identityTransfer.error')}
          </p>
        )}
        {state.phase === 'checking' && <p role="status">{t('common.loading')}</p>}
        {state.phase === 'check-error' && (
          <DialogButton onClick={() => void check(true)}>{t('common.errorRetry')}</DialogButton>
        )}
        {candidates?.map((candidate) => (
          <div key={candidate.guest_user_id} className="bg-surface-subtle rounded-xl border border-edge p-4">
            <div className="flex items-center justify-between gap-3">
              <strong className="text-content">{candidate.name}</strong>
              <button
                type="button"
                disabled={busy || candidate.conflicts.length > 0}
                onClick={() => void decide({ kind: 'claim', guestUserId: candidate.guest_user_id })}
                className="rounded-lg bg-content px-3 py-2 text-caption font-semibold text-surface disabled:opacity-40"
              >
                {t('members.identityTransfer.thisIsMe')}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {impacts(candidate)
                .filter(([, count]) => count > 0)
                .map(([key, count]) => (
                  <span key={key} className="rounded-full border border-edge px-2 py-1 text-caption text-content-muted">
                    {t(`members.identityTransfer.impact.${key}`, { count })}
                  </span>
                ))}
            </div>
            {candidate.impact.rating_overlaps > 0 && (
              <p className="mt-2 text-caption text-content-muted">
                {t('members.identityTransfer.ratingOverlap', { count: candidate.impact.rating_overlaps })}
              </p>
            )}
            {candidate.conflicts.length > 0 && (
              <div className="border-danger/30 bg-danger/5 mt-3 rounded-lg border p-3 text-caption text-danger">
                <p className="font-semibold">{t('members.identityTransfer.conflicts')}</p>
                <ul className="mt-1 list-disc ps-4">
                  {candidate.conflicts.map((conflict) => (
                    <li key={`${conflict.type}:${conflict.record_id}`}>
                      {conflict.type} #{conflict.record_id}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        {candidates?.length === 0 && (
          <p className="text-body text-content-muted">{t('members.identityTransfer.none')}</p>
        )}
      </div>
    </DialogShell>
  );
}

export function NewMemberIdentityCheck({ tripId }: { tripId: number | string }): React.ReactElement | null {
  const accountId = useAuthStore((state) => state.user?.id);
  const trip = useTripStore((state) => state.trip);
  if (!accountId || trip?.id !== Number(tripId) || trip.user_id === accountId) return null;
  return <GuestIdentityTransferModal tripId={tripId} open source="new-member" onClose={() => {}} />;
}
