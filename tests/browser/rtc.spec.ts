import { test, expect } from '@playwright/test';

test('two isolated participants negotiate through the local Worker, exchange chat, and finish matrix', async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage(),
    guest = await guestContext.newPage();
  await Promise.all([host.goto('/'), guest.goto('/')]);
  await Promise.all([
    host.evaluate(() => {
      window.__WEBRTC_TEST_PERF_LIMITS__ = {
        maxDirectionBytes: 64 * 1024,
        maxDurationMs: 500,
        pingTimeoutMs: 100,
      };
    }),
    guest.evaluate(() => {
      window.__WEBRTC_TEST_PERF_LIMITS__ = {
        maxDirectionBytes: 64 * 1024,
        maxDurationMs: 500,
        pingTimeoutMs: 100,
      };
    }),
  ]);
  await Promise.all([
    host.getByRole('button', { name: 'Run diagnostics' }).click(),
    guest.getByRole('button', { name: 'Run diagnostics' }).click(),
  ]);
  await Promise.all([
    expect(host.getByText(/complete\. Completion unlocks/)).toBeVisible({ timeout: 25_000 }),
    expect(guest.getByText(/complete\. Completion unlocks/)).toBeVisible({ timeout: 25_000 }),
  ]);
  await host.getByRole('button', { name: 'Create room' }).click();
  const code = (await host.locator('.RoomControls strong').first().textContent()) ?? '';
  await guest.getByLabel('Room code').fill(code);
  await guest.getByRole('button', { name: 'Join room' }).click();
  await expect(host.getByText(/Visible attempt: att_/)).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByText(/Visible attempt: att_/)).toBeVisible({ timeout: 30_000 });
  await expect(host.getByText(/Main ready:/)).toContainText('Main ready:', { timeout: 35_000 });
  await host.getByLabel('Message').fill('hello from host');
  await host.getByRole('button', { name: 'Send' }).click();
  await expect(guest.getByText('Peer: hello from host')).toBeVisible({ timeout: 10_000 });
  await guest.getByLabel('Message').fill('hello from guest');
  await guest.getByRole('button', { name: 'Send' }).click();
  await expect(host.getByText('Peer: hello from guest')).toBeVisible({ timeout: 10_000 });
  await expect(host.getByText(/Diagnostics complete: \d+\/\d+/)).toBeVisible({ timeout: 45_000 });
  await expect(host.getByText(/Complete: RTT min\/median\/p95\/max/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    host
      .getByLabel('Receiver measured directions')
      .getByText(/a-to-b: receiver [0-9].* [1-9][0-9]* bytes/),
  ).toBeVisible();
  await expect(
    host
      .getByLabel('Receiver measured directions')
      .getByText(/b-to-a: receiver [0-9].* [1-9][0-9]* bytes/),
  ).toBeVisible();
  await host.getByRole('button', { name: 'Compact view' }).click();
  await expect(host.locator('main')).toHaveClass(/compact/);
  await hostContext.close();
  await guestContext.close();
});

test('mandatory preflight invalidates after configuration changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create room' })).toBeDisabled();
  await page.getByRole('button', { name: 'Run diagnostics' }).click();
  await expect(page.getByText(/complete\. Completion unlocks/)).toBeVisible({ timeout: 25_000 });
  await page.getByLabel('TURN JSON').fill('{');
  await expect(page.getByRole('button', { name: 'Create room' })).toBeDisabled();
});

test('configuration rerun retries a new attempt and re-establishes the main path', async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await Promise.all([host.goto('/'), guest.goto('/')]);
  await Promise.all([
    host.getByRole('button', { name: 'Run diagnostics' }).click(),
    guest.getByRole('button', { name: 'Run diagnostics' }).click(),
  ]);
  await Promise.all([
    expect(host.getByText(/complete\. Completion unlocks/)).toBeVisible({ timeout: 25_000 }),
    expect(guest.getByText(/complete\. Completion unlocks/)).toBeVisible({ timeout: 25_000 }),
  ]);
  await host.getByRole('button', { name: 'Create room' }).click();
  const code = (await host.locator('.RoomControls strong').first().textContent()) ?? '';
  await guest.getByLabel('Room code').fill(code);
  await guest.getByRole('button', { name: 'Join room' }).click();
  await expect(host.getByText(/Visible attempt: att_/)).toBeVisible({ timeout: 30_000 });
  const previous = (await host.locator('.RoomControls strong').nth(1).textContent()) ?? '';
  await expect(host.getByText(/Main ready:/)).toContainText('Main ready:', { timeout: 35_000 });
  await host.getByLabel('TURN JSON').fill('{"iceServers":[]}');
  await host.getByRole('button', { name: 'Run diagnostics' }).click();
  await expect(host.getByText(/complete\. Completion unlocks/)).toBeVisible({ timeout: 25_000 });
  await expect
    .poll(async () => (await host.locator('.RoomControls strong').nth(1).textContent()) ?? '', {
      timeout: 35_000,
    })
    .not.toBe(previous);
  await expect(host.getByText(/Main ready:/)).toContainText('Main ready:', { timeout: 35_000 });
  await expect(guest.getByText(/Visible attempt: att_/)).toBeVisible({ timeout: 35_000 });
  await hostContext.close();
  await guestContext.close();
});
