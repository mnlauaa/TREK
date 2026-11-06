import type { GuestIdentityTransferCandidate } from '@trek/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tripRepo } from '../../repo/tripRepo';
import { useAuthStore } from '../../store/authStore';
import { useTripStore } from '../../store/tripStore';
import { isEffectivelyOnline, onNetworkModeChange } from '../../sync/networkMode';

type GuestIdentitySource = 'manual' | 'new-member';
type GuestIdentityDecision = { kind: 'claim'; guestUserId: number } | { kind: 'decline' };

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
  const request = useRef<symbol>(Symbol());
  const submitting = useRef(false);

  const check = useCallback(() => {
    const id = Symbol();
    request.current = id;
    const result =
      source === 'manual'
        ? tripRepo.guestIdentityTransferCandidates(tripId)
        : tripRepo.runNewMemberIdentityCheck(tripId);
    return result
      .then((result) => {
        const candidates = 'required' in result && !result.required ? null : result.candidates;
        if (id !== request.current) return;
        setState(candidates ? { phase: 'choosing', candidates } : { phase: 'hidden' });
      })
      .catch((error: unknown) => {
        if (id === request.current) setState({ phase: 'check-error', error });
      });
  }, [tripId, source]);

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
      request.current = Symbol();
    };
  }, [check, initialCandidates, source]);

  const close = () => {
    if (submitting.current) return;
    request.current = Symbol();
    setState({ phase: 'hidden' });
    onClose?.();
  };

  const decide = async (decision: GuestIdentityDecision) => {
    if (state.phase !== 'choosing' || submitting.current) return;
    const id = Symbol();
    request.current = id;
    const { candidates } = state;
    submitting.current = true;
    setState({ phase: 'submitting', candidates, decision });
    try {
      if (decision.kind === 'claim') await tripRepo.transferGuestIdentity(tripId, decision.guestUserId);
      else await tripRepo.declineNewMemberIdentityCheck(tripId);
    } catch (error) {
      if (id === request.current) setState({ phase: 'choosing', candidates, error });
      return;
    } finally {
      submitting.current = false;
    }
    const auth = useAuthStore.getState();
    if (decision.kind === 'claim' && auth.isAuthenticated && auth.user?.id === accountId) {
      useTripStore.getState().refreshTransferredGuest(tripId);
    }
    if (id !== request.current) return;
    close();
    if (decision.kind === 'claim') onTransferred?.();
  };

  const retry = (visible = true) => {
    setState({ phase: 'checking', visible });
    return check();
  };

  return { state, check: retry, close, decide };
}
