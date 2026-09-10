import { expect, test } from '@playwright/test';

test('preserves the stalled STUN signaling stage in cards, events and copied reports', async ({
  browser,
}) => {
  const hostContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let localResult: { outcome: string; detail: string } | undefined;
  await host.route('**/api/signals/**', async (route) => {
    const request = route.request();
    if (
      request.method() === 'GET' &&
      new URL(request.url()).searchParams.get('pair') === 'pair-stun-assisted-0'
    ) {
      // Withhold the answer without failing HTTP or disturbing the Direct probe.
      await route.fulfill({ json: { signals: [] } });
      return;
    }
    await route.continue();
  });
  await host.route('**/probes/pair-stun-assisted-0', async (route) => {
    if (route.request().method() === 'POST')
      localResult = route.request().postDataJSON() as { outcome: string; detail: string };
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
    await expect(host.getByRole('heading', { name: 'Connected', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(host.getByText('Network checks: 5 of 5 complete')).toBeVisible({
      timeout: 60_000,
    });
    expect(localResult?.outcome).toBe('timeout');
    expect(localResult?.detail).toMatch(
      /waiting for (?:the )?remote (?:offer\/answer|answer|description)/i,
    );
    expect(localResult?.detail).not.toContain('mapped-address connectivity timed out');

    await host.getByRole('button', { name: /diagnostics/i }).click();
    await host.getByText('Connection checks', { exact: true }).click();
    const stun = host.locator('.capability-card').filter({
      has: host.getByText('STUN mapped-address connectivity', { exact: true }),
    });
    await expect(stun).toContainText(localResult!.detail);
    await expect(stun).toContainText('without signaling local host candidates');
    await expect(stun).toContainText('a connectivity timeout does not mean the STUN server failed');
    await host.getByRole('button', { name: 'Pair details', exact: true }).click();
    await expect(
      host.getByRole('table', { name: 'STUN mapped-address connectivity pair details' }),
    ).toContainText(localResult!.detail);
    await host.getByText('Event log and timing', { exact: true }).click();
    await expect(host.locator('.event-list')).toContainText(localResult!.detail);
    await host.getByRole('button', { name: 'Copy report', exact: true }).click();
    const report = JSON.parse(await host.evaluate(() => navigator.clipboard.readText())) as {
      matrix: Array<{ id: string; label: string; detail: string }>;
      events: Array<{ payload: { message?: string } }>;
    };
    const copiedStun = report.matrix.find((row) => row.id === 'stun-assisted');
    expect(copiedStun?.label).toBe('STUN mapped-address connectivity');
    expect(copiedStun?.detail).toContain(localResult!.detail);
    expect(
      report.events.some((event) => event.payload.message?.includes(localResult!.detail)),
    ).toBe(true);
    await host.getByRole('button', { name: 'Compact report', exact: true }).click();
    await expect(host.locator('.compact-report')).toContainText('STUN mapped-address connectivity');
    await expect(host.locator('.compact-report')).toContainText(localResult!.detail);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
