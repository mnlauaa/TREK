import type { TripMembers } from '../entities/TripMembers.entity';
import type { DB } from '../kysely/db';
import { TrekRepository } from './_shared/trek-repository';
import { TICKET_NOTE_PREFIX } from '@trek/shared';

export interface GuestTransferScope {
  tripId: number;
  guestId: number;
  memberId: number;
}

export type GuestTicketWrite = { id: number; storage: 'ticket_json' | 'note'; json: string };

export abstract class GuestIdentityTransferRepository extends TrekRepository<TripMembers> {
  async guestTransferFinancials({ tripId, guestId, memberId }: GuestTransferScope) {
    const db =
      this.kysely<Pick<DB, 'budget_items' | 'budget_item_payers' | 'budget_item_members' | 'budget_settlements'>>();
    const expenses = await db
      .selectFrom('budget_items as item')
      .where('item.trip_id', '=', tripId)
      .select(['item.id', 'item.note', 'item.ticket_json', 'item.paid_by_user_id'])
      .select((eb) => [
        eb
          .exists(
            eb
              .selectFrom('budget_item_payers')
              .select('id')
              .whereRef('budget_item_id', '=', 'item.id')
              .where('user_id', '=', guestId),
          )
          .as('guest_pays'),
        eb
          .exists(
            eb
              .selectFrom('budget_item_payers')
              .select('id')
              .whereRef('budget_item_id', '=', 'item.id')
              .where('user_id', '=', memberId),
          )
          .as('member_pays'),
        eb
          .exists(
            eb
              .selectFrom('budget_item_members')
              .select('id')
              .whereRef('budget_item_id', '=', 'item.id')
              .where('user_id', '=', guestId),
          )
          .as('guest_shares'),
        eb
          .exists(
            eb
              .selectFrom('budget_item_members')
              .select('id')
              .whereRef('budget_item_id', '=', 'item.id')
              .where('user_id', '=', memberId),
          )
          .as('member_shares'),
      ])
      .orderBy('item.id')
      .execute();
    const settlements = await db
      .selectFrom('budget_settlements')
      .select(['id', 'from_user_id', 'to_user_id'])
      .where('trip_id', '=', tripId)
      .where((eb) => eb.or([eb('from_user_id', '=', guestId), eb('to_user_id', '=', guestId)]))
      .orderBy('id')
      .execute();
    return { expenses, settlements };
  }

  async guestTransferParticipation({ tripId, guestId, memberId }: GuestTransferScope) {
    const db =
      this.kysely<
        Pick<
          DB,
          | 'assignment_participants'
          | 'day_assignments'
          | 'days'
          | 'reservation_travelers'
          | 'reservations'
          | 'todo_items'
          | 'todo_category_assignees'
          | 'packing_items'
          | 'packing_item_recipients'
          | 'packing_item_contributors'
          | 'packing_category_assignees'
          | 'packing_bags'
          | 'packing_bag_members'
          | 'place_ratings'
          | 'places'
        >
      >();
    const itinerary = await db
      .selectFrom('assignment_participants as participant')
      .innerJoin('day_assignments as assignment', 'assignment.id', 'participant.assignment_id')
      .innerJoin('days as day', 'day.id', 'assignment.day_id')
      .where('day.trip_id', '=', tripId)
      .where('participant.user_id', '=', guestId)
      .select((eb) => eb.fn.count<number>('participant.assignment_id').distinct().as('count'))
      .executeTakeFirstOrThrow();
    const bookings = await db
      .selectFrom('reservation_travelers as traveler')
      .innerJoin('reservations as booking', 'booking.id', 'traveler.reservation_id')
      .where('booking.trip_id', '=', tripId)
      .where('traveler.user_id', '=', guestId)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const todos = await db
      .selectFrom('todo_items')
      .where('trip_id', '=', tripId)
      .where('assigned_user_id', '=', guestId)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const todoCategories = await db
      .selectFrom('todo_category_assignees')
      .where('trip_id', '=', tripId)
      .where('user_id', '=', guestId)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const packingItems = await db
      .selectFrom('packing_items as item')
      .where('trip_id', '=', tripId)
      .where((eb) =>
        eb.or([
          eb('item.owner_id', '=', guestId),
          eb.exists(
            eb
              .selectFrom('packing_item_recipients')
              .select('user_id')
              .whereRef('item_id', '=', 'item.id')
              .where('user_id', '=', guestId),
          ),
          eb.exists(
            eb
              .selectFrom('packing_item_contributors')
              .select('user_id')
              .whereRef('item_id', '=', 'item.id')
              .where('user_id', '=', guestId),
          ),
        ]),
      )
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const packingCategories = await db
      .selectFrom('packing_category_assignees')
      .where('trip_id', '=', tripId)
      .where('user_id', '=', guestId)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const packingBags = await db
      .selectFrom('packing_bags as bag')
      .where('trip_id', '=', tripId)
      .where((eb) =>
        eb.or([
          eb('bag.user_id', '=', guestId),
          eb.exists(
            eb
              .selectFrom('packing_bag_members')
              .select('user_id')
              .whereRef('bag_id', '=', 'bag.id')
              .where('user_id', '=', guestId),
          ),
        ]),
      )
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const ratings = await db
      .selectFrom('place_ratings as guest')
      .innerJoin('places', 'places.id', 'guest.place_id')
      .leftJoin('place_ratings as member', (join) =>
        join.onRef('member.place_id', '=', 'guest.place_id').on('member.user_id', '=', memberId),
      )
      .where('places.trip_id', '=', tripId)
      .where('guest.user_id', '=', guestId)
      .select((eb) => [eb.fn.countAll<number>().as('count'), eb.fn.count<number>('member.user_id').as('overlaps')])
      .executeTakeFirstOrThrow();
    return {
      itinerary: Number(itinerary.count),
      bookings: Number(bookings.count),
      todos: Number(todos.count) + Number(todoCategories.count),
      packing: Number(packingItems.count) + Number(packingCategories.count) + Number(packingBags.count),
      ratings: Number(ratings.count),
      rating_overlaps: Number(ratings.overlaps),
    };
  }

  async rewriteGuestFinancials(
    { tripId, guestId, memberId }: GuestTransferScope,
    tickets: GuestTicketWrite[],
  ): Promise<void> {
    const db =
      this.kysely<Pick<DB, 'budget_items' | 'budget_item_payers' | 'budget_item_members' | 'budget_settlements'>>();
    const expenseIds = db.selectFrom('budget_items').select('id').where('trip_id', '=', tripId);
    await db
      .updateTable('budget_item_members')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('budget_item_id', 'in', expenseIds)
      .execute();
    await db
      .updateTable('budget_item_payers')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('budget_item_id', 'in', expenseIds)
      .execute();
    await db
      .updateTable('budget_items')
      .set({ paid_by_user_id: memberId })
      .where('trip_id', '=', tripId)
      .where('paid_by_user_id', '=', guestId)
      .execute();
    await db
      .updateTable('budget_settlements')
      .set({ from_user_id: memberId })
      .where('trip_id', '=', tripId)
      .where('from_user_id', '=', guestId)
      .execute();
    await db
      .updateTable('budget_settlements')
      .set({ to_user_id: memberId })
      .where('trip_id', '=', tripId)
      .where('to_user_id', '=', guestId)
      .execute();
    await db
      .updateTable('budget_settlements')
      .set({ created_by_user_id: null })
      .where('trip_id', '=', tripId)
      .where('created_by_user_id', '=', guestId)
      .execute();
    for (const ticket of tickets) {
      const changes =
        ticket.storage === 'ticket_json' ? { ticket_json: ticket.json } : { note: TICKET_NOTE_PREFIX + ticket.json };
      await db
        .updateTable('budget_items')
        .set(changes)
        .where('id', '=', ticket.id)
        .where('trip_id', '=', tripId)
        .execute();
    }
  }

  async rewriteGuestParticipation({ tripId, guestId, memberId }: GuestTransferScope): Promise<void> {
    const db =
      this.kysely<
        Pick<
          DB,
          | 'assignment_participants'
          | 'day_assignments'
          | 'days'
          | 'reservation_travelers'
          | 'reservations'
          | 'todo_items'
          | 'todo_category_assignees'
          | 'packing_items'
          | 'packing_item_recipients'
          | 'packing_item_contributors'
          | 'packing_category_assignees'
          | 'packing_bags'
          | 'packing_bag_members'
          | 'place_ratings'
          | 'places'
        >
      >();
    const assignments = db
      .selectFrom('day_assignments as assignment')
      .innerJoin('days as day', 'day.id', 'assignment.day_id')
      .where('day.trip_id', '=', tripId)
      .select('assignment.id');
    const reservations = db.selectFrom('reservations').where('trip_id', '=', tripId).select('id');
    const items = db.selectFrom('packing_items').where('trip_id', '=', tripId).select('id');
    const bags = db.selectFrom('packing_bags').where('trip_id', '=', tripId).select('id');
    const places = db.selectFrom('places').where('trip_id', '=', tripId).select('id');

    await db
      .updateTable('todo_items')
      .set({ assigned_user_id: memberId })
      .where('trip_id', '=', tripId)
      .where('assigned_user_id', '=', guestId)
      .execute();
    await db
      .updateTable('packing_items')
      .set({ owner_id: memberId })
      .where('trip_id', '=', tripId)
      .where('owner_id', '=', guestId)
      .execute();
    await db
      .updateTable('packing_bags')
      .set({ user_id: memberId })
      .where('trip_id', '=', tripId)
      .where('user_id', '=', guestId)
      .execute();

    await db
      .deleteFrom('assignment_participants')
      .where('user_id', '=', guestId)
      .where('assignment_id', 'in', assignments)
      .where(
        'assignment_id',
        'in',
        db.selectFrom('assignment_participants').select('assignment_id').where('user_id', '=', memberId),
      )
      .execute();
    await db
      .updateTable('assignment_participants')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('assignment_id', 'in', assignments)
      .execute();

    await db
      .deleteFrom('reservation_travelers')
      .where('user_id', '=', guestId)
      .where('reservation_id', 'in', reservations)
      .where(
        'reservation_id',
        'in',
        db.selectFrom('reservation_travelers').select('reservation_id').where('user_id', '=', memberId),
      )
      .execute();
    await db
      .updateTable('reservation_travelers')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('reservation_id', 'in', reservations)
      .execute();

    await db
      .deleteFrom('packing_item_recipients')
      .where('user_id', '=', guestId)
      .where('item_id', 'in', items)
      .where(
        'item_id',
        'in',
        db.selectFrom('packing_item_recipients').select('item_id').where('user_id', '=', memberId),
      )
      .execute();
    await db
      .updateTable('packing_item_recipients')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('item_id', 'in', items)
      .execute();

    await db
      .deleteFrom('packing_item_contributors')
      .where('user_id', '=', guestId)
      .where('item_id', 'in', items)
      .where(
        'item_id',
        'in',
        db.selectFrom('packing_item_contributors').select('item_id').where('user_id', '=', memberId),
      )
      .execute();
    await db
      .updateTable('packing_item_contributors')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('item_id', 'in', items)
      .execute();

    await db
      .deleteFrom('packing_bag_members')
      .where('user_id', '=', guestId)
      .where('bag_id', 'in', bags)
      .where('bag_id', 'in', db.selectFrom('packing_bag_members').select('bag_id').where('user_id', '=', memberId))
      .execute();
    await db
      .updateTable('packing_bag_members')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('bag_id', 'in', bags)
      .execute();

    await db
      .deleteFrom('place_ratings')
      .where('user_id', '=', guestId)
      .where('place_id', 'in', places)
      .where('place_id', 'in', db.selectFrom('place_ratings').select('place_id').where('user_id', '=', memberId))
      .execute();
    await db
      .updateTable('place_ratings')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('place_id', 'in', places)
      .execute();

    await db
      .deleteFrom('todo_category_assignees')
      .where('user_id', '=', guestId)
      .where('trip_id', '=', tripId)
      .where(
        'category_name',
        'in',
        db
          .selectFrom('todo_category_assignees')
          .select('category_name')
          .where('user_id', '=', memberId)
          .where('trip_id', '=', tripId),
      )
      .execute();
    await db
      .updateTable('todo_category_assignees')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('trip_id', '=', tripId)
      .execute();

    await db
      .deleteFrom('packing_category_assignees')
      .where('user_id', '=', guestId)
      .where('trip_id', '=', tripId)
      .where(
        'category_name',
        'in',
        db
          .selectFrom('packing_category_assignees')
          .select('category_name')
          .where('user_id', '=', memberId)
          .where('trip_id', '=', tripId),
      )
      .execute();
    await db
      .updateTable('packing_category_assignees')
      .set({ user_id: memberId })
      .where('user_id', '=', guestId)
      .where('trip_id', '=', tripId)
      .execute();
  }
}
