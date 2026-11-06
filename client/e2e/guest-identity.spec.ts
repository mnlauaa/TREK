import { devices, expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import type { BudgetItem, BudgetSettlement, Trip, TripMember } from '@trek/shared';
import { randomUUID } from 'node:crypto';

const baseURL = process.env.TREK_TEST_URL ?? `http://localhost:${process.env.E2E_WEB_PORT || 5173}`;
const password = 'BrowserGuestTest123!';
const guestName = 'Guest Traveler';
const expenseName = 'Guest rail fare';
const popupTitle = 'Does a Guest represent you?';
const signedOut = { cookies: [], origins: [] };

async function read<T>(request: Promise<APIResponse>): Promise<T> {
  const response = await request;
  expect(response.ok(), `${response.url()} responded ${response.status()}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function seed(api: APIRequestContext) {
  const absolute = (path: string) => new URL(path, baseURL).href;
  const get = <T>(path: string) => read<T>(api.get(absolute(path)));
  const post = <T>(path: string, data: object) => read<T>(api.post(absolute(path), { data }));
  const { user: owner } = await get<{ user: { id: number; username: string } }>('/api/auth/me');
  const nonce = randomUUID().slice(0, 8);
  const accountEmail = `traveler-${nonce}@example.test`;
  const { user: account } = await post<{ user: { id: number; username: string } }>('/api/admin/users', {
    username: `Account Traveler ${nonce}`,
    email: accountEmail,
    password,
    role: 'user',
  });
  const { trip } = await post<{ trip: Trip }>('/api/trips', { title: `Guest identity ${nonce}`, currency: 'EUR' });
  const tripApi = `/api/trips/${trip.id}`;
  const { member: guest } = await post<{ member: TripMember }>(`${tripApi}/guests`, { name: guestName });
  await post(`${tripApi}/budget`, {
    name: expenseName,
    currency: 'USD',
    exchange_rate: 1.2,
    exchange_rate_note: 'Booked rate',
    expense_date: '2026-07-08',
    payers: [{ user_id: guest.id, amount: 120 }],
    members: [
      { user_id: guest.id, amount: 45 },
      { user_id: owner.id, amount: 75 },
    ],
  });
  await post(`${tripApi}/budget`, {
    name: 'Shared dinner',
    currency: 'EUR',
    expense_date: '2026-07-09',
    payers: [{ user_id: owner.id, amount: 25 }],
    member_ids: [owner.id, guest.id],
  });
  await post(`${tripApi}/budget/settlements`, {
    from_user_id: guest.id,
    to_user_id: owner.id,
    amount: 12.34,
    currency: 'USD',
    exchange_rate: 1.25,
    exchange_rate_note: 'First payment rate',
    settled_at: '2026-07-10',
  });
  await post(`${tripApi}/budget/settlements`, {
    from_user_id: owner.id,
    to_user_id: guest.id,
    amount: 23.45,
    currency: 'GBP',
    exchange_rate: 0.85,
    exchange_rate_note: 'Second payment rate',
    settled_at: '2026-07-11',
  });
  const { token } = await post<{ token: string }>(`${tripApi}/invite-link`, {});
  const ledger = async () => {
    const [{ items }, { settlements }, { members }, summary] = await Promise.all([
      get<{ items: BudgetItem[] }>(`${tripApi}/budget`),
      get<{ settlements: BudgetSettlement[] }>(`${tripApi}/budget/settlements`),
      get<{ members: TripMember[] }>(`${tripApi}/members`),
      get<{ currency: string; balances: Array<{ user_id: number; balance: number }> }>(
        `${tripApi}/budget/settlement?base=EUR`
      ),
    ]);
    return { items, settlements, members, summary };
  };
  return { trip, tripApi, owner, guest, account, accountEmail, token, ledger };
}
type Fixture = Awaited<ReturnType<typeof seed>>;

async function join(page: Page, fixture: Fixture) {
  await page.route('**/api/system-notices/active?*', (route) => route.fulfill({ json: [] }));
  await page.goto(`/join/${fixture.token}`);
  await page.locator('input[type="email"]').fill(fixture.accountEmail);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('button', { name: 'Join trip', exact: true })).toBeEnabled();
  await page.evaluate((tripId) => sessionStorage.setItem(`trip-tab-${tripId}`, 'finanzplan'), fixture.trip.id);
  await page.getByRole('button', { name: 'Join trip', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${fixture.trip.id}$`));
}

function payment(page: Page, from: string, to: string) {
  return page.getByText(`${from} → ${to}`, { exact: true }).and(page.locator(':not(.sr-only)'));
}

const sorted = <T extends { id: number }>(rows: T[]) => [...rows].sort((a, b) => a.id - b.id);
const sortedPeople = <T extends { user_id: number }>(rows: T[]) => [...rows].sort((a, b) => a.user_id - b.user_id);
const byIdentity = ({ id, username }: TripMember) => ({ id, username });
const itemValues = ({ members, payers, ...item }: BudgetItem) => ({
  ...item,
  members: sortedPeople(
    (members ?? []).map(({ user_id, amount, paid, username }) => ({ user_id, amount, paid, username }))
  ),
  payers: sortedPeople((payers ?? []).map(({ user_id, amount, username }) => ({ user_id, amount, username }))),
});
const settlementValues = ({ from_avatar_url, to_avatar_url, ...payment }: BudgetSettlement) => payment;

for (const [viewport, device] of [
  ['desktop', devices['Desktop Chrome']],
  ['phone', devices['iPhone 13']],
] as const) {
  test(`${viewport} claims a guest and keeps the open expense ledger current`, async ({
    page: admin,
    browser,
  }, testInfo) => {
    const fixture = await seed(admin.request);
    const { owner, guest, account } = fixture;
    const before = await fixture.ledger();
    let ownerDocument: number | undefined;
    if (viewport === 'desktop') {
      await admin.goto(`${baseURL}/trips/${fixture.trip.id}?tab=finanzplan`);
      await expect(payment(admin, guestName, 'You')).toBeVisible();
      await expect(payment(admin, 'You', guestName)).toBeVisible();
      ownerDocument = await admin.evaluate(() => performance.timeOrigin);
    }
    const contextOptions = {
      viewport: device.viewport,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      deviceScaleFactor: 1,
    };
    const context = await browser.newContext({ ...contextOptions, baseURL, locale: 'en-US', storageState: signedOut });
    try {
      const page = await context.newPage();
      await join(page, fixture);
      const dialog = page.getByRole('dialog', { name: popupTitle });
      await expect(dialog.getByText(guestName, { exact: true })).toBeVisible();
      await expect(dialog.getByText('2 expenses', { exact: true })).toBeVisible();
      await expect(dialog.getByText('2 payments', { exact: true })).toBeVisible();
      await expect(page.getByText(expenseName, { exact: true })).toBeVisible();
      await expect(payment(page, guestName, owner.username)).toBeVisible();
      await expect(payment(page, owner.username, guestName)).toBeVisible();
      const claimantDocument = await page.evaluate(() => performance.timeOrigin);
      await page.screenshot({ path: testInfo.outputPath('guest-popup.png') });
      await dialog.getByRole('button', { name: 'This is me', exact: true }).click();
      await expect(dialog).toBeHidden();

      const after = await fixture.ledger();
      expect(after.members.map(byIdentity)).toEqual(
        expect.arrayContaining([{ id: account.id, username: account.username }])
      );
      expect(after.members.map((member) => member.id)).not.toContain(guest.id);
      const substitute = (id: number) => (id === guest.id ? account.id : id);
      const rename = (name: string | undefined) => (name === guestName ? account.username : name);
      expect(after.summary.currency).toBe(before.summary.currency);
      expect(sortedPeople(after.summary.balances.map(({ user_id, balance }) => ({ user_id, balance })))).toEqual(
        sortedPeople(before.summary.balances.map(({ user_id, balance }) => ({ user_id: substitute(user_id), balance })))
      );
      expect(sorted(after.items).map(itemValues)).toEqual(
        sorted(before.items).map((item) =>
          itemValues({
            ...item,
            paid_by_user_id: item.paid_by_user_id == null ? item.paid_by_user_id : substitute(item.paid_by_user_id),
            members: item.members?.map((member) => ({
              ...member,
              user_id: substitute(member.user_id),
              username: rename(member.username)!,
            })),
            payers: item.payers?.map((payer) => ({
              ...payer,
              user_id: substitute(payer.user_id),
              username: rename(payer.username),
            })),
          })
        )
      );
      expect(sorted(after.settlements).map(settlementValues)).toEqual(
        sorted(before.settlements).map((row) =>
          settlementValues({
            ...row,
            from_user_id: substitute(row.from_user_id),
            to_user_id: substitute(row.to_user_id),
            from_username: rename(row.from_username),
            to_username: rename(row.to_username),
          })
        )
      );

      await expect(payment(page, 'You', owner.username)).toBeVisible();
      await expect(payment(page, owner.username, 'You')).toBeVisible();
      await expect(payment(page, guestName, owner.username)).toHaveCount(0);
      await expect(payment(page, owner.username, guestName)).toHaveCount(0);
      if (viewport === 'desktop') {
        const expense = page.locator('.exp-row').filter({ hasText: expenseName });
        await expense.locator('span.bg-surface-card.border').first().hover();
        await expect(page.getByRole('tooltip')).toHaveText('You');
        await expect(expense).not.toContainText(guestName);
        await expect(payment(admin, account.username, 'You')).toBeVisible();
        await expect(payment(admin, 'You', account.username)).toBeVisible();
        const ownerExpense = admin.locator('.exp-row').filter({ hasText: expenseName });
        await ownerExpense.locator('span.bg-surface-card.border').first().hover();
        await expect(admin.getByRole('tooltip')).toHaveText(account.username);
        await expect(ownerExpense).not.toContainText(guestName);
        expect(await admin.evaluate(() => performance.timeOrigin)).toBe(ownerDocument);
      }
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(claimantDocument);
      await page.screenshot({ path: testInfo.outputPath('updated-expenses.png'), fullPage: true });
    } finally {
      await context.close();
    }
  });
}

test('recovers from a failed identity check and a failed decline', async ({ page: admin, browser }) => {
  const fixture = await seed(admin.request);
  const before = await fixture.ledger();
  const context = await browser.newContext({ baseURL, locale: 'en-US', storageState: signedOut });
  try {
    const page = await context.newPage();
    const check = `**${fixture.tripApi}/new-member-identity-check`;
    const decline = `${check}/decline`;
    const unavailable = { status: 503, json: { error: 'Temporarily unavailable' } };
    let checkUnavailable = true;
    await page.route(check, (route) => (checkUnavailable ? route.fulfill(unavailable) : route.continue()));
    await page.route(decline, (route) => route.fulfill(unavailable), { times: 1 });
    await join(page, fixture);
    const retry = page.getByRole('button', { name: /try again|retry/i });
    await expect(retry).toBeVisible();
    checkUnavailable = false;
    await retry.click();
    const dialog = page.getByRole('dialog', { name: popupTitle });
    await expect(dialog.getByText(guestName, { exact: true })).toBeVisible();
    const none = dialog.getByRole('button', { name: 'None of these are me', exact: true });
    const failed = page.waitForResponse(
      (response) => response.url().endsWith('/new-member-identity-check/decline') && response.status() === 503
    );
    await none.click();
    await failed;
    await expect(dialog).toBeVisible();
    await expect(none).toBeEnabled();
    const succeeded = page.waitForResponse(
      (response) => response.url().endsWith('/new-member-identity-check/decline') && response.ok()
    );
    await none.click();
    await succeeded;
    await expect(dialog).toBeHidden();
    const checked = page.waitForResponse(
      (response) => response.url().endsWith('/new-member-identity-check') && response.ok()
    );
    await page.reload();
    expect(await (await checked).json()).toMatchObject({ required: false });
    await expect(dialog).toBeHidden();
    const after = await fixture.ledger();
    expect(after.members.map((member) => member.id)).toContain(fixture.guest.id);
    expect(after.items).toEqual(before.items);
    expect(after.settlements).toEqual(before.settlements);
  } finally {
    await context.close();
  }
});
