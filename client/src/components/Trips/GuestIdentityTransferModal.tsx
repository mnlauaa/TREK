import type { GuestIdentityTransferCandidate } from '@trek/shared';
import { UserRound } from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';
import { DialogButton, DialogFooter, DialogHeader, DialogShell, DialogTile, NEUTRAL_TINT } from '../shared/DialogShell';

import { useTranslation } from '../../i18n';
import { tripRepo } from '../../repo/tripRepo';
import { useTripStore } from '../../store/tripStore';
import { useToast } from '../shared/Toast';

interface TransferDialogProps {
  tripId: number | string;
  candidates?: GuestIdentityTransferCandidate[];
  onClose: () => void;
  onTransferred?: () => void;
  onDecline?: () => Promise<void>;
}

export default function GuestIdentityTransferModal({
  open,
  ...props
}: TransferDialogProps & { open: boolean }): React.ReactElement | null {
  return open ? <TransferDialog key={props.tripId} {...props} /> : null;
}

function TransferDialog({
  tripId,
  candidates: initialCandidates,
  onClose,
  onTransferred,
  onDecline,
}: TransferDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const labelId = useId();
  const [loaded, setLoaded] = useState<GuestIdentityTransferCandidate[] | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);

  useEffect(() => {
    if (initialCandidates) return;
    let active = true;
    void tripRepo
      .guestIdentityTransferCandidates(tripId)
      .then((result) => {
        if (active) setLoaded(result.candidates);
      })
      .catch(() => {
        if (active) setLoaded('failed');
      });
    return () => {
      active = false;
    };
  }, [initialCandidates, tripId]);
  const result = initialCandidates ?? loaded;
  const candidates = result === 'failed' ? null : result;

  const submit = async (write: () => Promise<void>) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      await write();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('members.identityTransfer.error'));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  const transfer = (candidate: GuestIdentityTransferCandidate) => {
    if (candidate.conflicts.length > 0) return;
    void submit(async () => {
      await tripRepo.transferGuestIdentity(tripId, candidate.guest_user_id);
      toast.success(t('members.identityTransfer.success'));
      useTripStore.getState().refreshTransferredGuest(tripId);
      onTransferred?.();
    });
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
          onClose={() => {
            if (!writing.current) onClose();
          }}
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
              onClick={() => {
                void submit(onDecline);
              }}
            >
              {t('members.identityTransfer.noneOfThese')}
            </DialogButton>
          </DialogFooter>
        )
      }
    >
      <div className="space-y-3">
        {result === 'failed' && (
          <p role="alert" className="text-danger">
            {t('members.identityTransfer.error')}
          </p>
        )}
        {result === null && <p role="status">{t('common.loading')}</p>}
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
      .catch(() => {
        if (active) setOpen(false);
      });
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
