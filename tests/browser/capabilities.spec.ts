import { expect, test, type BrowserContext } from '@playwright/test';

async function useShortPerformanceProbe(...contexts: BrowserContext[]) {
  await Promise.all(
    contexts.map((context) =>
      context.addInitScript(() => {
        window.__WEBRTC_TEST_PERF_LIMITS__ = {
          maxDirectionBytes: 64 * 1024,
          maxDurationMs: 500,
          pingTimeoutMs: 100,
        };
      }),
    ),
  );
}

test('keeps chat usable but defers speed traffic until every capability category settles', async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await useShortPerformanceProbe(hostContext, guestContext);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let releaseStun: (() => void) | undefined;
  const stunGate = new Promise<void>((resolve) => {
    releaseStun = resolve;
  });
  for (const page of [host, guest]) {
    await page.route('**/probes/pair-stun-assisted-0', async (route) => {
      const response = await route.fetch();
      await stunGate;
      await route.fulfill({ response });
    });
  }

  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'Create a room' }).click();
    await expect(host.getByRole('heading', { name: 'Waiting for the other device' })).toBeVisible({
      timeout: 25_000,
    });
    const code = ((await host.locator('.invitation-card strong').textContent()) ?? '').trim();
    await guest.goto(`/?room=${code}`);
    await guest.getByRole('button', { name: 'Join room' }).click();

    await Promise.all([
      expect(host.getByRole('heading', { name: 'Connected' })).toBeVisible({ timeout: 120_000 }),
      expect(guest.getByRole('heading', { name: 'Connected' })).toBeVisible({ timeout: 120_000 }),
    ]);
    await expect(host.getByText(/Network checks: [0-4] of 5 complete/)).toBeVisible();
    await expect(host.locator('.room-performance p')).toHaveText('Not started');

    await host.getByLabel('Write a message').fill('chat before speed');
    await host.getByRole('button', { name: 'Send' }).click();
    await expect(guest.getByText('chat before speed')).toBeVisible({ timeout: 10_000 });

    releaseStun?.();
    await expect(host.getByText('Network checks: 5 of 5 complete')).toBeVisible({
      timeout: 90_000,
    });
    await expect(host.locator('.room-performance p')).not.toHaveText('Not started', {
      timeout: 10_000,
    });
  } finally {
    releaseStun?.();
    await hostContext.close();
    await guestContext.close();
  }
});

test('recovers an authoritative pass after the result POST response times out', async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await useShortPerformanceProbe(hostContext, guestContext);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let releasePost: (() => void) | undefined;
  const postGate = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  let recoveryGetObserved = false;
  let heldPost = false;
  await host.route('**/probes/pair-direct-0', async (route) => {
    if (route.request().method() === 'POST' && !heldPost) {
      heldPost = true;
      const response = await route.fetch();
      await postGate;
      await route.fulfill({ response });
      return;
    }
    if (route.request().method() === 'GET') recoveryGetObserved = true;
    await route.continue();
  });

  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'Create a room' }).click();
    await expect(host.getByRole('heading', { name: 'Waiting for the other device' })).toBeVisible({
      timeout: 25_000,
    });
    const code = ((await host.locator('.invitation-card strong').textContent()) ?? '').trim();
    await guest.goto(`/?room=${code}`);
    await guest.getByRole('button', { name: 'Join room' }).click();

    await expect.poll(() => recoveryGetObserved, { timeout: 20_000 }).toBe(true);
    releasePost?.();
    await Promise.all([
      expect(host.getByRole('heading', { name: 'Connected' })).toBeVisible({ timeout: 30_000 }),
      expect(guest.getByRole('heading', { name: 'Connected' })).toBeVisible({ timeout: 30_000 }),
    ]);
    await host.getByLabel('Write a message').fill('recovered host channel');
    await host.getByRole('button', { name: 'Send' }).click();
    await expect(guest.getByText('recovered host channel')).toBeVisible({ timeout: 10_000 });
    await guest.getByLabel('Write a message').fill('recovered guest channel');
    await guest.getByRole('button', { name: 'Send' }).click();
    await expect(host.getByText('recovered guest channel')).toBeVisible({ timeout: 10_000 });
  } finally {
    releasePost?.();
    await hostContext.close();
    await guestContext.close();
  }
});
