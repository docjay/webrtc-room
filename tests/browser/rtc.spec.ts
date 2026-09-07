import { expect, test, type Page } from '@playwright/test';

async function capture(page: Page, name: string) {
  const directory = process.env.UX_EVIDENCE_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
}

async function openDiagnostics(page: Page) {
  await page.getByRole('button', { name: /diagnostics/i }).click();
  await expect(page.locator('.diagnostics-drawer')).toBeVisible();
}

async function currentAttempt(page: Page) {
  await openDiagnostics(page);
  const summary = page.getByLabel('Diagnostic summary');
  await expect(summary).toContainText(/Attempt att_/, { timeout: 30_000 });
  const text = (await summary.textContent()) ?? '';
  await page.getByRole('button', { name: 'Close diagnostics' }).click();
  return text.match(/att_[a-f0-9]{32}/)?.[0] ?? '';
}

test('automatic checks keep explicit intent pending and the mobile drawer accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?room=ABC234');

  await expect(page.getByRole('heading', { name: 'Join room ABC234' })).toBeVisible();
  await expect(page.locator('.diagnostics-drawer')).toHaveCount(0);
  await expect(page.getByText(/Checking device: \d+ of \d+/)).toBeVisible();
  await capture(page, 'mobile-invitation-checking');

  const join = page.getByRole('button', { name: 'Join room' });
  await expect(join).toBeEnabled();
  await join.click();
  await expect(page.getByRole('button', { name: 'Cancel pending action' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel pending action' }).click();
  await expect(page.getByRole('button', { name: 'Join room' })).toBeVisible();

  const opener = page.getByRole('button', { name: 'View diagnostics' });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await expect(page.getByRole('button', { name: 'Close diagnostics' })).toBeFocused();
  await capture(page, 'mobile-diagnostics-drawer');

  await page.getByText('Advanced network settings', { exact: true }).click();
  const serverJson = page.getByLabel('Optional STUN/TURN server JSON');
  await expect(serverJson).toHaveAttribute('placeholder', /"iceServers"/);
  await expect(page.getByText(/STUN discovers public network addresses/)).toBeVisible();
  await serverJson.fill('{');
  await page.getByRole('button', { name: 'Apply settings' }).click();
  await expect(page.getByRole('alert')).toContainText(/JSON|property|position/i);
  await capture(page, 'mobile-settings-failure');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDiagnostics(page);
  await expect(page.locator('.diagnostics-drawer[role="region"]')).toBeVisible();
  await expect(page.locator('.diagnostics-drawer')).not.toHaveAttribute('aria-modal');
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await capture(page, 'desktop-diagnostics-drawer');
});

test('two devices auto-check, connect, exchange chat, finish the matrix, and render one report', async ({
  browser,
}) => {
  const hostContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const guestContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await Promise.all([
    hostContext.addInitScript(() => {
      window.__WEBRTC_TEST_PERF_LIMITS__ = {
        maxDirectionBytes: 64 * 1024,
        maxDurationMs: 500,
        pingTimeoutMs: 100,
      };
    }),
    guestContext.addInitScript(() => {
      window.__WEBRTC_TEST_PERF_LIMITS__ = {
        maxDirectionBytes: 64 * 1024,
        maxDurationMs: 500,
        pingTimeoutMs: 100,
      };
    }),
  ]);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await host.goto('/');

  const create = host.getByRole('button', { name: 'Create a room' });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(host.getByRole('heading', { name: 'Waiting for the other device' })).toBeVisible({
    timeout: 25_000,
  });
  await capture(host, 'desktop-waiting-room');
  const code = ((await host.locator('.invitation-card strong').textContent()) ?? '').trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6,10}$/);
  await host.getByRole('button', { name: 'Copy invitation' }).click();
  await expect(host.getByText('Invitation copied.')).toBeVisible();

  await guest.goto(`/?room=${code}`);
  await expect(guest.getByRole('heading', { name: `Join room ${code}` })).toBeVisible();
  await guest.getByRole('button', { name: 'Join room' }).click();

  await Promise.all([
    expect(host.getByRole('heading', { name: 'Connected' })).toBeVisible({ timeout: 120_000 }),
    expect(guest.getByRole('heading', { name: 'Connected' })).toBeVisible({ timeout: 120_000 }),
  ]);
  await capture(host, 'desktop-connected-room');
  await expect(host.getByText(/Network checks: \d+ of \d+ complete/)).toBeVisible();

  await host.getByLabel('Write a message').fill('hello from host');
  await host.getByRole('button', { name: 'Send' }).click();
  await expect(guest.getByText('hello from host')).toBeVisible({ timeout: 10_000 });
  await guest.getByLabel('Write a message').fill('hello from guest');
  await guest.getByRole('button', { name: 'Send' }).click();
  await expect(host.getByText('hello from guest')).toBeVisible({ timeout: 10_000 });

  await expect
    .poll(
      async () => {
        const text = (await host.getByText(/Network checks:/).textContent()) ?? '';
        const match = text.match(/(\d+) of (\d+)/);
        return match ? match[1] === match[2] : false;
      },
      { timeout: 90_000 },
    )
    .toBe(true);

  const hostAttempt = await currentAttempt(host);
  const guestAttempt = await currentAttempt(guest);
  expect(hostAttempt).toBe(guestAttempt);

  await openDiagnostics(host);
  await host.getByText('Connection speed check', { exact: true }).click();
  await expect(host.getByText(/Complete: RTT min\/median\/p95\/max/)).toBeVisible({
    timeout: 20_000,
  });
  await capture(host, 'desktop-connected-diagnostics');
  await host.getByRole('button', { name: 'Copy report' }).click();
  const copied = JSON.parse(await host.evaluate(() => navigator.clipboard.readText())) as {
    runId: string;
    attemptId: string;
    matrix: Array<{ id: string; outcome: string; selected?: string }>;
    outcome: string;
  };
  expect(copied.runId).toMatch(/^run_/);
  expect(copied.attemptId).toBe(hostAttempt);
  expect(copied.matrix).toHaveLength(16);
  const passedStunRows = copied.matrix.filter(
    (row) => row.id.includes('stun-') && row.outcome === 'pass',
  );
  expect(passedStunRows.length).toBeGreaterThan(0);
  expect(passedStunRows.every((row) => /(?:srflx|prflx)/.test(row.selected ?? ''))).toBe(true);
  expect(copied.outcome).toBe('Connected');
  await host.getByRole('button', { name: 'Compact report' }).click();
  const compact = host.getByRole('heading', { name: 'Connection summary' });
  await expect(compact).toBeVisible();
  await expect(host.locator('.compact-report')).toContainText(hostAttempt);
  await expect(host.locator('.compact-report')).toContainText('Connected');
  await capture(host, 'desktop-compact-report');

  await openDiagnostics(guest);
  await guest.getByText('Connection speed check', { exact: true }).click();
  await expect(guest.getByText(/(?:[1-9]|1\d|20)\/20 answered/)).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test('a guest-applied configuration starts a shared retry generation', async ({ browser }) => {
  test.setTimeout(240_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await host.goto('/');
  await host.getByRole('button', { name: 'Create a room' }).click();
  await expect(host.getByRole('heading', { name: 'Waiting for the other device' })).toBeVisible({
    timeout: 25_000,
  });
  const code = ((await host.locator('.invitation-card strong').textContent()) ?? '').trim();
  await guest.goto(`/?room=${code}`);
  await guest.getByRole('button', { name: 'Join room' }).click();
  const previous = await currentAttempt(host);
  expect(await currentAttempt(guest)).toBe(previous);

  await openDiagnostics(guest);
  await guest.getByText('Advanced network settings', { exact: true }).click();
  await guest.getByLabel('Optional STUN/TURN server JSON').fill('{"iceServers":[]}');
  guest.once('dialog', (dialog) => void dialog.accept());
  await guest.getByRole('button', { name: 'Apply settings' }).click();
  await guest.getByRole('button', { name: 'Close diagnostics' }).click();

  await expect.poll(() => currentAttempt(host), { timeout: 90_000 }).not.toBe(previous);
  const retried = await currentAttempt(host);
  expect(await currentAttempt(guest)).toBe(retried);

  await hostContext.close();
  await guestContext.close();
});
