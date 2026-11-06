import { devices, expect, test } from '@playwright/test';
import { dismissSystemNotices } from './helpers';

for (const mobile of [false, true]) {
  test.describe(mobile ? 'Option A mobile plan' : 'Option A desktop plan', () => {
    if (mobile)
      test.use({ viewport: devices['Pixel 7'].viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    test('compact chips preserve upstream edit and recalculate later visits', async ({ page }) => {
      await page.goto('/dashboard');
      await dismissSystemNotices(page);
      const created = await page.request.post('/api/trips', {
        data: { title: `Option A ${Date.now()}`, start_date: '2099-06-01', end_date: '2099-06-01' },
      });
      expect(created.ok()).toBeTruthy();
      const { trip } = await created.json();
      const root = `/api/trips/${trip.id}`;
      const { days } = await (await page.request.get(`${root}/days`)).json();
      const visits: number[] = [];
      for (const [name, lat] of [
        ['First stop', 22.28],
        ['Second stop', 22.29],
      ] as const) {
        const { place } = await (
          await page.request.post(`${root}/places`, { data: { name, lat, lng: 114.15 } })
        ).json();
        const { assignment } = await (
          await page.request.post(`${root}/days/${days[0].id}/assignments`, { data: { place_id: place.id } })
        ).json();
        visits.push(assignment.id);
        expect(
          (await page.request.put(`${root}/assignments/${assignment.id}/stay`, { data: { stay_minutes: 30 } })).ok()
        ).toBeTruthy();
      }
      await page.request.put(`${root}/days/${days[0].id}/transport`, { data: { transport_mode: 'walking' } });
      await page.request.put(`${root}/days/${days[0].id}/timing`, {
        data: {
          enabled: true,
          start: '09:00',
          travel: [{ from: `assignment:${visits[0]}`, to: `assignment:${visits[1]}`, mode: 'walking', minutes: 20 }],
        },
      });
      await page.goto(`/trips/${trip.id}`);
      if (mobile) await page.getByRole('button', { name: 'Plan', exact: true }).first().click();
      const first = page.getByTestId(`visit-timing-${visits[0]}`);
      const second = page.getByTestId(`visit-timing-${visits[1]}`);
      await expect(first.getByText('09:00–09:30')).toBeVisible();
      const automatic = page.getByRole('switch', { name: 'Automatic timing', exact: true });
      await expect(automatic).toHaveAttribute('aria-checked', 'true');
      await automatic.click();
      await expect(automatic).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('button', { name: /Day start time/ })).toBeDisabled();
      await expect(automatic).toBeEnabled();
      await page.reload();
      if (mobile) await page.getByRole('button', { name: 'Plan', exact: true }).first().click();
      await expect(automatic).toHaveAttribute('aria-checked', 'false');
      await automatic.click();
      await expect(first.getByText('09:00–09:30')).toBeVisible();
      const editDayStart = async (value: string, save: boolean) => {
        await expect(
          page.getByText('Arrival and departure follow stay and travel times.', { exact: true })
        ).toHaveCount(0);
        await page.getByRole('button', { name: /Day start time/ }).click();
        await expect(
          page.getByText('Arrival and departure follow stay and travel times.', { exact: true })
        ).toBeVisible();
        const input = page.getByRole('textbox', { name: 'Day start time', exact: true });
        await input.fill(value);
        await input.press('Tab');
        await page.getByRole('button', { name: save ? 'Save' : 'Cancel', exact: true }).click();
      };
      await editDayStart('08:00', false);
      await expect(first.getByText('09:00–09:30')).toBeVisible();
      await editDayStart('08:00', true);
      await expect(first.getByText('08:00–08:30')).toBeVisible();
      await expect(second.getByText('08:50–09:20')).toBeVisible();
      await editDayStart('09:00', true);

      await expect(second.getByText('09:50–10:20')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Set fixed times', exact: true })).toHaveCount(0);
      await first.getByRole('button', { name: /Time at this stop/ }).click();
      await page.getByRole('button', { name: '1 h', exact: true }).click();
      await page
        .getByRole('button', { name: mobile ? 'Close' : 'Cancel', exact: true })
        .last()
        .click();
      await expect(first.getByText('09:00–09:30')).toBeVisible();
      await first.getByRole('button', { name: /Time at this stop/ }).click();
      await page.getByRole('button', { name: '1 h', exact: true }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).last().click();
      await expect(first.getByText('09:00–10:00')).toBeVisible();
      await expect(second.getByText('10:20–10:50')).toBeVisible();
      await page.reload();
      if (mobile) await page.getByRole('button', { name: 'Plan', exact: true }).first().click();
      await expect(first.getByText('09:00–10:00')).toBeVisible();
      const edit = async () => {
        if (mobile) {
          await page
            .getByRole('button', { name: /^First stop/ })
            .filter({ has: page.getByRole('button', { name: 'Edit', exact: true }) })
            .getByRole('button', { name: 'Edit', exact: true })
            .click();
        } else {
          await page.getByText('First stop', { exact: true }).first().click({ button: 'right' });
          await page.getByRole('menu').getByText('Edit', { exact: true }).click();
        }
      };
      const start = () =>
        mobile ? page.getByPlaceholder('00:00').nth(0) : page.getByRole('textbox', { name: 'Start', exact: true });
      const end = () =>
        mobile ? page.getByPlaceholder('00:00').nth(1) : page.getByRole('textbox', { name: 'End', exact: true });
      const save = async () => {
        const response = page.waitForResponse(
          (response) =>
            response.url().endsWith(`/assignments/${visits[0]}/time`) && response.request().method() === 'PUT'
        );
        await page.getByRole('button', { name: mobile ? 'Save' : 'Update', exact: true }).click();
        expect((await response).ok()).toBeTruthy();
      };
      await edit();
      await start().fill('11:00');
      await start().press('Tab');
      await save();
      await expect(first.getByText('11:00–12:00')).toBeVisible();
      await expect(first.getByText('Fixed start 11:00', { exact: true })).toBeVisible();
      await expect(second.getByText('12:20–12:50')).toBeVisible();
      await edit();
      await expect(start()).toHaveValue('11:00');
      await start().fill('');
      await end().fill('09:30');
      await expect(
        page.getByText('Setting End determines the stay. Leave End empty to edit the duration.', { exact: true })
      ).toBeVisible();
      await end().press('Tab');
      await save();
      await expect(first.getByText('09:00–09:30')).toBeVisible();
      await expect(first.getByRole('button', { name: /Time at this stop/ })).toHaveCount(0);
      await expect(first.getByText('Fixed end 09:30', { exact: true })).toBeVisible();
      await edit();
      await end().fill('');
      await expect(end()).toHaveValue('');
      await end().press('Tab');
      await expect(end()).toHaveValue('');
      await save();
      await expect(first.getByText('09:00–10:00')).toBeVisible();
      await expect(second.getByText('10:20–10:50')).toBeVisible();
      await expect(first.getByText(/Fixed end/)).toHaveCount(0);
      await page.screenshot({ path: `/tmp/trek-option-a-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    });
  });
}
