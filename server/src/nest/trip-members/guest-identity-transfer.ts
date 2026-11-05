import type {
  GuestIdentityTransferRepository,
  GuestTicketWrite,
  GuestTransferScope,
} from '../../db/repositories/GuestIdentityTransfer.repository';
import { TICKET_NOTE_PREFIX, ticketPayloadSchema, type GuestIdentityTransferConflict } from '@trek/shared';

export class GuestIdentityTransferError extends Error {
  constructor(
    public readonly code:
      'GUEST_IDENTITY_TRANSFER_FORBIDDEN' | 'GUEST_IDENTITY_TRANSFER_CONFLICT' | 'GUEST_ALREADY_TRANSFERRED',
    message: string,
    public readonly conflicts: GuestIdentityTransferConflict[] = [],
  ) {
    super(message);
    this.name = 'GuestIdentityTransferError';
  }
}

type GuestFinancialRows = Awaited<ReturnType<GuestIdentityTransferRepository['guestTransferFinancials']>>;

function readTicket(raw: string) {
  try {
    const result = ticketPayloadSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function planGuestFinancialTransfer({ guestId, memberId }: GuestTransferScope, rows: GuestFinancialRows) {
  const conflicts: GuestIdentityTransferConflict[] = [];
  const tickets: GuestTicketWrite[] = [];
  const addConflict = (type: GuestIdentityTransferConflict['type'], record_id: number) =>
    conflicts.push({ type, record_id });
  let expenses = 0;
  for (const row of rows.expenses) {
    const guestPays = row.paid_by_user_id === guestId || !!row.guest_pays;
    const memberPays = row.paid_by_user_id === memberId || !!row.member_pays;
    const guestShares = !!row.guest_shares;
    if (guestShares && row.member_shares) addConflict('expense_share_overlap', row.id);
    if (guestPays && memberPays) addConflict('expense_payer_overlap', row.id);

    const raw =
      row.ticket_json || (row.note?.startsWith(TICKET_NOTE_PREFIX) ? row.note.slice(TICKET_NOTE_PREFIX.length) : null);
    const ticket = raw ? readTicket(raw) : null;
    const lines = ticket?.items.filter((item) => item.parts.includes(guestId)) ?? [];
    if (guestPays || guestShares || lines.length > 0) expenses++;
    if (raw && !ticket && (guestPays || guestShares)) addConflict('invalid_ticket_json', row.id);
    if (lines.some((item) => item.parts.includes(memberId))) addConflict('ticket_participant_overlap', row.id);
    if (lines.length > 0) {
      for (const item of lines) item.parts = item.parts.map((id) => (id === guestId ? memberId : id));
      tickets.push({ id: row.id, storage: row.ticket_json ? 'ticket_json' : 'note', json: JSON.stringify(ticket) });
    }
  }

  for (const { id, from_user_id, to_user_id } of rows.settlements) {
    const from = from_user_id === guestId ? memberId : from_user_id;
    const to = to_user_id === guestId ? memberId : to_user_id;
    if (from === to) addConflict('settlement_self_payment', id);
  }

  return { conflicts, tickets, expenses, payments: rows.settlements.length };
}
