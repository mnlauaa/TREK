import { buildApp } from '../../src/bootstrap';
import { db } from '../../src/db/database';
import { BudgetItems } from '../../src/db/entities/BudgetItems.entity';
import { BudgetSettlements } from '../../src/db/entities/BudgetSettlements.entity';
import { GlobalExchangeRateSnapshots } from '../../src/db/entities/GlobalExchangeRateSnapshots.entity';
import { authCookie } from '../helpers/auth';
import { addTripMember, createTrip, createUser } from '../helpers/factories';
import { findRow, insertRow } from '../helpers/factories/rows';
import { resetRateLimits, resetTestDb } from '../helpers/test-db';
import { sharedTestOrm } from '../helpers/test-uow';
import type { INestApplication } from '@nestjs/common';

import type { Application } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/database', async () => {
  const { buildDbMock, createSnapshotTestDb } = await import('../helpers/db-mock');
  return buildDbMock(createSnapshotTestDb());
});

let nest: INestApplication;
let app: Application;

beforeAll(async () => {
  nest = await buildApp();
  app = nest.getHttpAdapter().getInstance();
});
beforeEach(async () => {
  resetTestDb(db);
  await resetRateLimits(nest);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await nest.close();
  db.close();
});

describe('fork exchange rates over REST', () => {
  it('persists intentional 1:1, ignores untrusted provenance, and applies a stored preview once', async () => {
    const { user } = createUser(db);
    const trip = createTrip(db, user.id);
    const cookie = authCookie(user.id);
    const costs = `/api/trips/${trip.id}/budget`;
    const rates = `/api/trips/${trip.id}/exchange-rates/CAD`;
    const created = await request(app).post(costs).set('Cookie', cookie).send({
      name: 'Explicit 1:1',
      currency: 'CAD',
      total_price: 30,
      exchange_rate: 1,
      exchange_rate_source: 'global',
      exchange_rate_set_by_user_id: 99,
    });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({
      exchange_rate: 1,
      exchange_rate_source: 'explicit',
      exchange_rate_set_by_user_id: user.id,
    });
    const id = created.body.item.id;
    const orm = await sharedTestOrm(db);
    const legacyId = await insertRow(orm, BudgetItems, {
      trip: trip.id,
      name: 'Legacy 1',
      total_price: 10,
      currency: 'CAD',
    });
    await insertRow(orm, GlobalExchangeRateSnapshots, {
      base_currency: 'EUR',
      rates_json: '{"EUR":1,"CAD":1.5}',
      source_version: 'fixture',
      effective_date: '2026-01-01',
      fetched_at: new Date().toISOString(),
    });

    const summary = await request(app).get(`${costs}/settlement`).set('Cookie', cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.unconverted.item_ids).toEqual([legacyId]);
    expect((await findRow(orm, BudgetItems, { id: legacyId }))?.exchange_rate_source).toBe('legacy');

    const preview = async () => request(app).post(`${rates}/preview`).set('Cookie', cookie).send({ exchange_rate: 2 });
    const stale = await preview();
    expect(stale.status).toBe(201);
    expect(stale.body.rows).toEqual([
      expect.objectContaining({ id, old_trip_value: 30, source: 'explicit', selected: false }),
      expect.objectContaining({ id: legacyId, old_trip_value: null, trip_value_delta: null, source: 'legacy' }),
    ]);
    const edited = await request(app).put(`${costs}/${id}`).set('Cookie', cookie).send({ total_price: 34 });
    expect(edited.body.item.exchange_rate_source_version).toBe(created.body.item.exchange_rate_source_version);
    const apply = async (preview_id: string) =>
      request(app)
        .post(`${rates}/apply`)
        .set('Cookie', cookie)
        .send({ preview_id, selected: [{ type: 'expense', id: legacyId }] });
    expect((await apply(stale.body.preview_id)).status).toBe(409);

    const current = await preview();
    const applied = await apply(current.body.preview_id);
    expect(applied.status).toBe(201);
    expect(applied.body).toMatchObject({ rate: { exchange_rate: 2 }, updated: [{ type: 'expense', id: legacyId }] });
    expect((await apply(current.body.preview_id)).status).toBe(400);
    const read = await request(app).get(costs).set('Cookie', cookie);
    expect(read.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, exchange_rate: 1, exchange_rate_source: 'explicit' }),
        expect.objectContaining({ id: legacyId, exchange_rate: 2, exchange_rate_source: 'trip' }),
      ]),
    );
  });

  it('rejects an unquoted foreign expense and books reservation prices at the trip default', async () => {
    const { user } = createUser(db);
    const trip = createTrip(db, user.id);
    const cookie = authCookie(user.id);
    const base = `/api/trips/${trip.id}`;
    const missing = await request(app).post(`${base}/budget`).set('Cookie', cookie).send({
      name: 'No foreign quote',
      currency: 'ZZZ',
      total_price: 42,
    });
    expect(missing.status).toBe(400);
    const set = await request(app)
      .put(`${base}/exchange-rates/ZZZ`)
      .set('Cookie', cookie)
      .send({ exchange_rate: 1, note: 'Booked rate' });
    expect(set.status).toBe(200);

    const booking = await request(app)
      .post(`${base}/reservations`)
      .set('Cookie', cookie)
      .send({
        title: 'Booked in another currency',
        create_budget_entry: { currency: 'ZZZ', total_price: 42 },
      });
    expect(booking.status).toBe(201);
    const row = await findRow(await sharedTestOrm(db), BudgetItems, { trip: trip.id });
    expect(row).toMatchObject({
      currency: 'ZZZ',
      exchange_rate: 1,
      exchange_rate_source: 'trip',
      exchange_rate_set_by_user_id: user.id,
    });
  });

  it('rebases booked expenses, transfers and defaults together using the outgoing-currency bridge', async () => {
    const { user } = createUser(db);
    const { user: member } = createUser(db);
    const trip = createTrip(db, user.id);
    addTripMember(db, trip.id, member.id);
    const cookie = authCookie(user.id);
    const base = `/api/trips/${trip.id}`;
    const costs = `${base}/budget`;
    const rates = `${base}/exchange-rates`;
    const orm = await sharedTestOrm(db);
    await insertRow(orm, GlobalExchangeRateSnapshots, {
      base_currency: 'USD',
      rates_json: '{"USD":1,"EUR":0.8}',
      source_version: 'test-bridge',
      fetched_at: new Date().toISOString(),
    });
    const change = (currency: string) => request(app).put(base).set('Cookie', cookie).send({ currency });
    const set = await request(app).put(`${rates}/CAD`).set('Cookie', cookie).send({ exchange_rate: 1.25 });
    expect(set.status).toBe(200);
    const expense = await request(app)
      .post(costs)
      .set('Cookie', cookie)
      .send({ name: 'Implicit euros', total_price: 100 });
    expect(expense.status).toBe(201);
    const payment = await request(app).post(`${costs}/settlements`).set('Cookie', cookie).send({
      from_user_id: user.id,
      to_user_id: member.id,
      currency: 'CAD',
      exchange_rate: 1,
      amount: 24,
    });
    expect(payment.status).toBe(201);
    expect((await change('ZZZ')).status).toBe(400);
    expect((await findRow(orm, BudgetSettlements, { id: payment.body.settlement.id }))?.exchange_rate).toBe(1);

    expect((await change('USD')).status).toBe(200);
    expect(await findRow(orm, BudgetItems, { id: expense.body.item.id })).toMatchObject({
      currency: 'EUR',
      exchange_rate: 0.8,
      total_price: 100,
    });
    expect(await findRow(orm, BudgetSettlements, { id: payment.body.settlement.id })).toMatchObject({
      currency: 'CAD',
      exchange_rate: 0.8,
      amount: 24,
      exchange_rate_source: 'explicit',
    });
    const defaults = await request(app).get(rates).set('Cookie', cookie);
    expect(defaults.body.rates).toEqual([expect.objectContaining({ currency: 'CAD', exchange_rate: 1 })]);
  });
});
