import { expect, test } from '@playwright/test';

test('upstream push settings are available on desktop and phone', async ({ page }) => {
  const enabled = await page.request.put('/api/auth/app-settings', {
    data: { notification_channels: 'push' },
  });
  expect(enabled.ok()).toBeTruthy();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings?tab=notifications');
    await expect(page.getByText('Push notifications on this device', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText(
      'Notifications are blocked for TREK in this browser. Allow them in the browser settings, then try again.',
    );
    await expect(page.getByText('Device name', { exact: true })).toHaveCount(0);
  }
});
