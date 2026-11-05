import type { GuestIdentityTransferCandidate } from '@trek/shared';
import { UserRound } from 'lucide-react';
import React, { useEffect, useId, useState } from 'react';
import { DialogButton, DialogFooter, DialogHeader, DialogShell, DialogTile, NEUTRAL_TINT } from '../shared/DialogShell';

import { useTranslation } from '../../i18n';
import { tripRepo } from '../../repo/tripRepo';
import { useToast } from '../shared/Toast';

export default function GuestIdentityTransferModal({
  tripId,
  open,
  candidates: initialCandidates,
  onClose,
  onTransferred,
  onDecline,
}: {
  tripId: number | string;
  open: boolean;
  candidates?: GuestIdentityTransferCandidate[];
  onClose: () => void;
  onTransferred?: () => void;
  onDecline?: () => Promise<void>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const labelId = useId();
  const [loaded, setLoaded] = useState<{
    tripId: number | string;
    candidates: GuestIdentityTransferCandidate[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || initialCandidates) return;
    let active = true;
    setLoaded(null);
    setFailed(false);
    void tripRepo
      .guestIdentityTransferCandidates(tripId)
      .then((result) => {
        if (active) setLoaded({ tripId, candidates: result.candidates });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [initialCandidates, open, tripId]);
  const candidates = initialCandidates ?? (loaded?.tripId === tripId ? loaded.candidates : null);
  if (!open) return null;

  const transfer = async (candidate: GuestIdentityTransferCandidate) => {
    if (candidate.conflicts.length > 0) return;
    setBusy(true);
    try {
      await tripRepo.transferGuestIdentity(tripId, candidate.guest_user_id);
      toast.success(t('members.identityTransfer.success'));
      window.dispatchEvent(new CustomEvent('guest:identity-transferred', { detail: tripId }));
      onTransferred?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('members.identityTransfer.error'));
    } finally {
      setBusy(false);
    }
  };

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
      onClose={onClose}
      labelledBy={labelId}
      blocked={busy}
      header={
        <DialogHeader
          labelId={labelId}
          onClose={onClose}
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
        onDecline && (
          <DialogFooter>
            <DialogButton
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDecline();
                  onClose();
                } catch {
                  toast.error(t('members.identityTransfer.error'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('members.identityTransfer.noneOfThese')}
            </DialogButton>
          </DialogFooter>
        )
      }
    >
      <div className="space-y-3">
        {failed && (
          <p role="alert" className="text-danger">
            {t('members.identityTransfer.error')}
          </p>
        )}
        {!failed && candidates === null && <p role="status">{t('common.loading')}</p>}
        {candidates?.map((candidate) => (
          <div key={candidate.guest_user_id} className="bg-surface-subtle rounded-xl border border-edge p-4">
            <div className="flex items-center justify-between gap-3">
              <strong className="text-content">{candidate.name}</strong>
              <button
                type="button"
                disabled={busy || candidate.conflicts.length > 0}
                onClick={() => transfer(candidate)}
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
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<GuestIdentityTransferCandidate[]>([]);

  useEffect(() => {
    let active = true;
    tripRepo
      .runNewMemberIdentityCheck(tripId)
      .then((result) => {
        if (active && result.required) {
          setCandidates(result.candidates);
          setOpen(true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tripId]);

  if (!open) return null;
  return (
    <GuestIdentityTransferModal
      tripId={tripId}
      open
      candidates={candidates}
      onClose={() => setOpen(false)}
      onDecline={async () => {
        await tripRepo.declineNewMemberIdentityCheck(tripId);
      }}
    />
  );
}
