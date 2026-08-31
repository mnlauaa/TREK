import { DatabaseService } from '../../../src/nest/database/database.service';
import { GuestIdentityTransferError, TripMembersService } from '../../../src/nest/trip-members/trip-members.service';
import { createTestDb } from '../../helpers/test-db';

import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('TripMembersService Guest identity transfer', () => {
  let db: Database.Database;
  let service: TripMembersService;
  const erasePluginUserData = vi.fn();

  beforeEach(() => {
    db = createTestDb();
    const dbs = new DatabaseService(db);
    service = new TripMembersService(
      dbs,
      {} as never,
      { erasePluginUserData } as never,
      {} as never,
      { broadcast: vi.fn() } as never,
      {} as never,
    );
    db.prepare(
      "INSERT INTO users (username,email,password_hash,role) VALUES ('owner','owner@example.test','x','admin')",
    ).run();
    const owner = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as { id: number };
    db.prepare(
      "INSERT INTO users (username,email,password_hash,role,is_guest,display_name) VALUES ('member','member@example.test','x','user',0,'Member')",
    ).run();
    db.prepare(
      "INSERT INTO users (username,email,password_hash,role,is_guest,display_name) VALUES ('guest-handle','guest@example.invalid','', 'user',1,'Guest Sam')",
    ).run();
    const member = db.prepare("SELECT id FROM users WHERE username='member'").get() as { id: number };
    const guest = db.prepare("SELECT id FROM users WHERE username='guest-handle'").get() as { id: number };
    const tripId = Number(
      db.prepare("INSERT INTO trips (user_id,title,currency) VALUES (?, 'Trip','EUR')").run(owner.id).lastInsertRowid,
    );
    db.prepare('INSERT INTO trip_members (trip_id,user_id) VALUES (?,?)').run(tripId, member.id);
    db.prepare(
      'INSERT INTO trip_members (trip_id,user_id,new_member_identity_check_completed_at) VALUES (?,?,CURRENT_TIMESTAMP)',
    ).run(tripId, guest.id);
  });

  afterEach(() => {
    erasePluginUserData.mockReset();
    db.close();
  });

  const ids = () => ({
    trip: (db.prepare("SELECT id FROM trips WHERE title='Trip'").get() as { id: number }).id,
    owner: (db.prepare("SELECT id FROM users WHERE username='owner'").get() as { id: number }).id,
    member: (db.prepare("SELECT id FROM users WHERE username='member'").get() as { id: number }).id,
    guest: (db.prepare("SELECT id FROM users WHERE username='guest-handle'").get() as { id: number }).id,
  });

  it('moves v4 traveler/ticket/rating participation and keeps the member rating on overlap', () => {
    const { trip, member, guest } = ids();
    const placeId = Number(
      db.prepare("INSERT INTO places (trip_id,name) VALUES (?, 'Museum')").run(trip).lastInsertRowid,
    );
    db.prepare('INSERT INTO place_ratings (place_id,user_id,rating) VALUES (?,?,5)').run(placeId, guest);
    db.prepare('INSERT INTO place_ratings (place_id,user_id,rating) VALUES (?,?,3)').run(placeId, member);
    const reservationId = Number(
      db.prepare("INSERT INTO reservations (trip_id,title,type) VALUES (?, 'Train','train')").run(trip).lastInsertRowid,
    );
    db.prepare('INSERT INTO reservation_travelers (reservation_id,user_id) VALUES (?,?)').run(reservationId, guest);
    db.prepare('INSERT INTO reservation_travelers (reservation_id,user_id) VALUES (?,?)').run(reservationId, member);
    const ticket = JSON.stringify({ items: [{ name: 'Ticket', price: 10, parts: [guest] }] });
    const budgetId = Number(
      db
        .prepare(
          "INSERT INTO budget_items (trip_id,category,name,total_price,ticket_json) VALUES (?, 'activities','Museum',10,?)",
        )
        .run(trip, ticket).lastInsertRowid,
    );

    const preview = service.listGuestIdentityTransferCandidates(trip, member)[0];
    expect(preview.impact).toMatchObject({ bookings: 1, ratings: 1, rating_overlaps: 1, expenses: 1 });
    expect(preview.conflicts).toEqual([]);

    service.transferGuestIdentity(trip, guest, member);

    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(guest)).toBeUndefined();
    expect(
      db.prepare('SELECT rating FROM place_ratings WHERE place_id = ? AND user_id = ?').get(placeId, member),
    ).toEqual({ rating: 3 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM reservation_travelers WHERE reservation_id = ?').get(reservationId),
    ).toEqual({ count: 1 });
    const stored = db.prepare('SELECT ticket_json FROM budget_items WHERE id = ?').get(budgetId) as {
      ticket_json: string;
    };
    expect(JSON.parse(stored.ticket_json).items[0].parts).toEqual([member]);
    expect(erasePluginUserData).toHaveBeenCalledWith(guest);
  });

  it('blocks an overlapping expense share without partially rewriting the trip', () => {
    const { trip, member, guest } = ids();
    const itemId = Number(
      db
        .prepare("INSERT INTO budget_items (trip_id,category,name,total_price) VALUES (?, 'food','Dinner',20)")
        .run(trip).lastInsertRowid,
    );
    db.prepare('INSERT INTO budget_item_members (budget_item_id,user_id,paid) VALUES (?,?,0)').run(itemId, guest);
    db.prepare('INSERT INTO budget_item_members (budget_item_id,user_id,paid) VALUES (?,?,0)').run(itemId, member);

    expect(() => service.transferGuestIdentity(trip, guest, member)).toThrow(GuestIdentityTransferError);
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(guest)).toEqual({ id: guest });
    expect(erasePluginUserData).not.toHaveBeenCalled();
  });

  it('allows only a non-owner account member to inspect or transfer Guest identities', () => {
    const { trip, owner, member, guest } = ids();
    expect(() => service.listGuestIdentityTransferCandidates(trip, owner)).toThrowError(
      expect.objectContaining({ code: 'GUEST_IDENTITY_TRANSFER_FORBIDDEN' }),
    );
    expect(() => service.listGuestIdentityTransferCandidates(99999, member)).toThrowError(
      expect.objectContaining({ code: 'GUEST_IDENTITY_TRANSFER_FORBIDDEN' }),
    );

    const stranger = Number(
      db
        .prepare(
          "INSERT INTO users (username,email,password_hash,role) VALUES ('stranger','stranger@example.test','x','user')",
        )
        .run().lastInsertRowid,
    );
    expect(() => service.listGuestIdentityTransferCandidates(trip, stranger)).toThrowError(
      expect.objectContaining({ code: 'GUEST_IDENTITY_TRANSFER_FORBIDDEN' }),
    );

    const otherTrip = Number(
      db.prepare("INSERT INTO trips (user_id,title,currency) VALUES (?, 'Other','EUR')").run(owner).lastInsertRowid,
    );
    db.prepare('INSERT INTO trip_members (trip_id,user_id) VALUES (?,?)').run(otherTrip, member);
    expect(() => service.transferGuestIdentity(otherTrip, guest, member)).toThrowError(
      expect.objectContaining({ code: 'GUEST_IDENTITY_TRANSFER_FORBIDDEN' }),
    );
    expect(() => service.transferGuestIdentity(trip, 999999, member)).toThrowError(
      expect.objectContaining({ code: 'GUEST_ALREADY_TRANSFERRED' }),
    );
  });

  it('discloses payer, ticket, malformed-ticket, and self-settlement conflicts without duplicates', () => {
    const { trip, member, guest } = ids();
    const itemId = Number(
      db
        .prepare(
          `INSERT INTO budget_items (trip_id,category,name,total_price,paid_by_user_id,ticket_json)
           VALUES (?, 'food','Dinner',20,?,?)`,
        )
        .run(trip, guest, JSON.stringify({ items: [{ name: 'Shared ticket', price: 20, parts: [guest, member] }] }))
        .lastInsertRowid,
    );
    db.prepare('INSERT INTO budget_item_payers (budget_item_id,user_id,amount) VALUES (?,?,10)').run(itemId, guest);
    db.prepare('INSERT INTO budget_item_payers (budget_item_id,user_id,amount) VALUES (?,?,10)').run(itemId, member);
    db.prepare('INSERT INTO budget_item_members (budget_item_id,user_id,paid) VALUES (?,?,0)').run(itemId, guest);
    db.prepare('INSERT INTO budget_item_members (budget_item_id,user_id,paid) VALUES (?,?,0)').run(itemId, member);

    const malformedId = Number(
      db
        .prepare(
          "INSERT INTO budget_items (trip_id,category,name,total_price,paid_by_user_id,ticket_json) VALUES (?, 'other','Bad',1,?,'{')",
        )
        .run(trip, guest).lastInsertRowid,
    );
    const settlementId = Number(
      db
        .prepare('INSERT INTO budget_settlements (trip_id,from_user_id,to_user_id,amount) VALUES (?,?,?,5)')
        .run(trip, guest, member).lastInsertRowid,
    );

    const preview = service.listGuestIdentityTransferCandidates(trip, member)[0];
    expect(preview.conflicts).toEqual(
      expect.arrayContaining([
        { type: 'expense_share_overlap', record_id: itemId },
        { type: 'expense_payer_overlap', record_id: itemId },
        { type: 'ticket_participant_overlap', record_id: itemId },
        { type: 'invalid_ticket_json', record_id: malformedId },
        { type: 'settlement_self_payment', record_id: settlementId },
      ]),
    );
    expect(new Set(preview.conflicts.map((conflict) => `${conflict.type}:${conflict.record_id}`)).size).toBe(
      preview.conflicts.length,
    );
    expect(preview.impact).toMatchObject({ expenses: 2, payments: 1 });
  });

  it('supports the new-member prompt lifecycle, including no-candidate auto-completion', () => {
    const { trip, member, guest } = ids();
    expect(service.runNewMemberIdentityCheck(trip, member)).toMatchObject({ required: true });
    expect(service.completeNewMemberIdentityCheck(trip, member)).toEqual({ success: true });
    expect(service.runNewMemberIdentityCheck(trip, member)).toEqual({ required: false, candidates: [] });

    db.prepare('DELETE FROM users WHERE id=?').run(guest);
    db.prepare('UPDATE trip_members SET new_member_identity_check_completed_at=NULL WHERE trip_id=? AND user_id=?').run(
      trip,
      member,
    );
    expect(service.runNewMemberIdentityCheck(trip, member)).toEqual({ required: false, candidates: [] });
    expect(
      db
        .prepare(
          'SELECT new_member_identity_check_completed_at AS completed FROM trip_members WHERE trip_id=? AND user_id=?',
        )
        .get(trip, member),
    ).toMatchObject({ completed: expect.any(String) });
  });

  it('rewrites canonical and legacy ticket storage while ignoring unrelated malformed tickets', () => {
    const { trip, member, guest } = ids();
    const legacyPayload = { items: [{ name: 'Legacy', price: 4, parts: [999, guest] }] };
    const legacyId = Number(
      db
        .prepare("INSERT INTO budget_items (trip_id,category,name,total_price,note) VALUES (?, 'other','Legacy',4,?)")
        .run(trip, `TICKETJSON:${JSON.stringify(legacyPayload)}`).lastInsertRowid,
    );
    const untouchedId = Number(
      db
        .prepare(
          "INSERT INTO budget_items (trip_id,category,name,total_price,ticket_json) VALUES (?, 'other','Untouched',2,?)",
        )
        .run(trip, JSON.stringify({ items: [{ name: 'Other', price: 2, parts: [999] }] })).lastInsertRowid,
    );
    const malformedId = Number(
      db
        .prepare(
          "INSERT INTO budget_items (trip_id,category,name,total_price,ticket_json) VALUES (?, 'other','Malformed',1,'{')",
        )
        .run(trip).lastInsertRowid,
    );

    expect(service.transferGuestIdentity(trip, guest, member)).toMatchObject({ success: true });
    const legacy = db.prepare('SELECT note FROM budget_items WHERE id=?').get(legacyId) as { note: string };
    expect(JSON.parse(legacy.note.slice('TICKETJSON:'.length)).items[0].parts).toEqual([999, member]);
    expect(
      JSON.parse((db.prepare('SELECT ticket_json FROM budget_items WHERE id=?').get(untouchedId) as any).ticket_json),
    ).toMatchObject({ items: [{ parts: [999] }] });
    expect(db.prepare('SELECT ticket_json FROM budget_items WHERE id=?').get(malformedId)).toEqual({
      ticket_json: '{',
    });
  });
});
