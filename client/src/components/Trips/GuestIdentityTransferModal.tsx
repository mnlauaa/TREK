import type { GuestIdentityTransferCandidate } from '@trek/shared';
import { isAxiosError } from 'axios';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../../i18n';
import type { GuestIdentitySource } from '../../repo/guestIdentityRepo';
import { useAuthStore } from '../../store/authStore';
import { useTripStore } from '../../store/tripStore';
import { getApiErrorMessage } from '../../types';
import { useToast } from '../shared/Toast';
import { useGuestIdentityCheck } from './useGuestIdentityCheck';

type ManualProps = {
  tripId: number | string;
  open: boolean;
  candidates?: GuestIdentityTransferCandidate[];
  onClose: () => void;
  onTransferred?: () => void;
};

export default function GuestIdentityTransferModal({
  tripId,
  open,
  candidates,
  ...callbacks
}: ManualProps): ReactElement | null {
  const accountId = useAuthStore((state) => state.user?.id);
  return open ? (
    <GuestIdentityPopup
      key={`${tripId}:${accountId}`}
      tripId={Number(tripId)}
      accountId={accountId}
      source="manual"
      initialCandidates={candidates}
      {...callbacks}
    />
  ) : null;
}

export function NewMemberIdentityCheck({ tripId }: { tripId: number | string }): ReactElement | null {
  const accountId = useAuthStore((state) => state.user?.id);
  const trip = useTripStore((state) => state.trip);
  if (!accountId || trip?.id !== Number(tripId) || trip.user_id === accountId) return null;

  return (
    <GuestIdentityPopup key={`${tripId}:${accountId}`} tripId={trip.id} accountId={accountId} source="new-member" />
  );
}

function GuestIdentityPopup({
  tripId,
  accountId,
  source,
  initialCandidates,
  onClose,
  onTransferred,
}: Pick<ManualProps, 'onTransferred'> & {
  tripId: number;
  accountId: number | undefined;
  source: GuestIdentitySource;
  initialCandidates?: GuestIdentityTransferCandidate[];
  onClose?: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const { state, check, close, decide } = useGuestIdentityCheck({
    tripId,
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
  const hasError = 'error' in state;
  const error = hasError ? state.error : undefined;

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

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('members.identityTransfer.title')}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-content">{t('members.identityTransfer.title')}</h2>
            <p className="mt-1 text-sm text-content-muted">{t('members.identityTransfer.description')}</p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label={t('common.close')}
            className="text-xl text-content-muted disabled:opacity-40"
          >
            ×
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {hasError && (
            <p role="alert" className="text-sm text-danger">
              {isAxiosError(error) && error.response
                ? getApiErrorMessage(error, t('members.identityTransfer.error'))
                : t('members.identityTransfer.error')}
            </p>
          )}
          {state.phase === 'checking' && <p role="status">{t('common.loading')}</p>}
          {state.phase === 'check-error' && (
            <button
              type="button"
              onClick={() => check(true)}
              className="rounded-lg border border-edge px-3 py-2 text-sm"
            >
              {t('common.errorRetry')}
            </button>
          )}
          {candidates?.map((candidate) => (
            <div key={candidate.guest_user_id} className="bg-surface-subtle rounded-xl border border-edge p-4">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-content">{candidate.name}</strong>
                <button
                  type="button"
                  disabled={busy || candidate.conflicts.length > 0}
                  onClick={() => decide({ kind: 'claim', guestUserId: candidate.guest_user_id })}
                  className="rounded-lg bg-content px-3 py-2 text-xs font-semibold text-surface disabled:opacity-40"
                >
                  {t('members.identityTransfer.thisIsMe')}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {impacts(candidate)
                  .filter(([, count]) => count > 0)
                  .map(([key, count]) => (
                    <span
                      key={key}
                      className="rounded-full border border-edge px-2 py-1 text-[0.65rem] text-content-muted"
                    >
                      {t(`members.identityTransfer.impact.${key}`, { count })}
                    </span>
                  ))}
              </div>
              {candidate.impact.rating_overlaps > 0 && (
                <p className="mt-2 text-xs text-content-muted">
                  {t('members.identityTransfer.ratingOverlap', { count: candidate.impact.rating_overlaps })}
                </p>
              )}
              {candidate.conflicts.length > 0 && (
                <div className="border-danger/30 bg-danger/5 mt-3 rounded-lg border p-3 text-xs text-danger">
                  <p className="font-semibold">{t('members.identityTransfer.conflicts')}</p>
                  <ul className="mt-1 list-disc pl-4">
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
            <p className="text-sm text-content-muted">{t('members.identityTransfer.none')}</p>
          )}
        </div>
        {source === 'new-member' && candidates && (
          <button
            type="button"
            disabled={busy}
            onClick={() => decide({ kind: 'decline' })}
            className="mt-4 text-sm text-content-muted underline disabled:opacity-40"
          >
            {t('members.identityTransfer.noneOfThese')}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
