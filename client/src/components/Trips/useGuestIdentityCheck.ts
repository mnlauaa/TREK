import type { GuestIdentityTransferCandidate } from '@trek/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { guestIdentityRepo, type GuestIdentityDecision, type GuestIdentitySource } from '../../repo/guestIdentityRepo';
import { useAuthStore } from '../../store/authStore';
import { useTripStore } from '../../store/tripStore';
import { isEffectivelyOnline, onNetworkModeChange } from '../../sync/networkMode';

type Candidates = readonly GuestIdentityTransferCandidate[];

export type GuestIdentityPopupState =
  | { phase: 'checking'; visible: boolean }
  | { phase: 'check-error'; error: unknown }
  | { phase: 'hidden' }
  | { phase: 'choosing'; candidates: Candidates; error?: unknown }
  | { phase: 'submitting'; candidates: Candidates; decision: GuestIdentityDecision };

export function useGuestIdentityCheck({
  tripId,
  accountId,
  source,
  initialCandidates,
  onClose,
  onTransferred,
}: {
  tripId: number;
  accountId: number | undefined;
  source: GuestIdentitySource;
  initialCandidates?: Candidates;
  onClose?: () => void;
  onTransferred?: () => void;
}) {
  const [state, setState] = useState<GuestIdentityPopupState>(
    initialCandidates
      ? { phase: 'choosing', candidates: initialCandidates }
      : { phase: 'checking', visible: source === 'manual' }
  );
  const request = useRef(0);
  const submitting = useRef(false);

  const check = useCallback(
    async (visible = source === 'manual') => {
      const id = ++request.current;
      setState({ phase: 'checking', visible });
      try {
        const candidates = await guestIdentityRepo.read(tripId, source);
        if (id !== request.current) return;
        setState(candidates ? { phase: 'choosing', candidates } : { phase: 'hidden' });
      } catch (error) {
        if (id === request.current) setState({ phase: 'check-error', error });
      }
    },
    [tripId, source]
  );

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (!initialCandidates) {
      if (source === 'manual' || isEffectivelyOnline()) {
        void check();
      } else {
        unsubscribe = onNetworkModeChange(() => {
          if (!isEffectivelyOnline()) return;
          unsubscribe?.();
          void check();
        });
      }
    }
    return () => {
      unsubscribe?.();
      request.current++;
    };
  }, [check, initialCandidates, source]);

  const close = () => {
    if (submitting.current) return;
    request.current++;
    setState({ phase: 'hidden' });
    onClose?.();
  };

  const decide = async (decision: GuestIdentityDecision) => {
    if (state.phase !== 'choosing' || submitting.current) return;
    const id = ++request.current;
    const { candidates } = state;
    submitting.current = true;
    setState({ phase: 'submitting', candidates, decision });
    try {
      await guestIdentityRepo.decide(tripId, decision);
    } catch (error) {
      if (id === request.current) setState({ phase: 'choosing', candidates, error });
      return;
    } finally {
      submitting.current = false;
    }
    const auth = useAuthStore.getState();
    if (decision.kind === 'claim' && auth.isAuthenticated && auth.user?.id === accountId) {
      useTripStore.getState().refreshAfterGuestTransfer(tripId);
    }
    if (id !== request.current) return;
    close();
    if (decision.kind === 'claim') onTransferred?.();
  };

  return { state, check, close, decide };
}
