import {
  guestIdentityTransferCandidatesResponseSchema,
  guestIdentityTransferResponseSchema,
  newMemberIdentityCheckCompletionResponseSchema,
  newMemberIdentityCheckResponseSchema,
} from '@trek/shared';
import { isAxiosError } from 'axios';
import { tripsApi } from '../api/client';
import { isEffectivelyOffline } from '../sync/networkMode';

export type GuestIdentitySource = 'new-member' | 'manual';
export type GuestIdentityDecision = { kind: 'claim'; guestUserId: number } | { kind: 'decline' };

export const guestIdentityRepo = {
  async read(tripId: number, source: GuestIdentitySource) {
    if (isEffectivelyOffline()) throw new Error('Guest identity checks require a connection');
    if (source === 'manual') {
      return guestIdentityTransferCandidatesResponseSchema.parse(await tripsApi.guestIdentityTransferCandidates(tripId))
        .candidates;
    }
    try {
      const result = newMemberIdentityCheckResponseSchema.parse(await tripsApi.runNewMemberIdentityCheck(tripId));
      return result.required ? result.candidates : null;
    } catch (error) {
      if (
        isAxiosError(error) &&
        error.response?.status === 403 &&
        error.response.data?.code === 'GUEST_IDENTITY_TRANSFER_FORBIDDEN'
      ) {
        return null;
      }
      throw error;
    }
  },

  async decide(tripId: number, decision: GuestIdentityDecision) {
    if (isEffectivelyOffline()) throw new Error('Guest identity decisions require a connection');
    if (decision.kind === 'decline') {
      newMemberIdentityCheckCompletionResponseSchema.parse(await tripsApi.declineNewMemberIdentityCheck(tripId));
    } else {
      guestIdentityTransferResponseSchema.parse(await tripsApi.transferGuestIdentity(tripId, decision.guestUserId));
    }
  },
};
