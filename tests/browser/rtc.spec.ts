import { expect, test, type Page, type Request } from '@playwright/test';
import type { DiagnosticEvent } from '../../src/shared/domain.js';

async function capture(page: Page, name: string, fullPage = true) {
  const directory = process.env.UX_EVIDENCE_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png`, fullPage });
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
  await page.route('**/api/health', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?room=ABC234');

  await expect(page.getByRole('heading', { name: 'Join room ABC234' })).toBeVisible();
  const relayCode = page.getByLabel('TURN relay access code');
  await expect(relayCode).toBeVisible();
  await expect(relayCode).toHaveAttribute('type', 'password');
  await expect(relayCode).toHaveAttribute('autocomplete', 'off');
  await expect(relayCode).not.toHaveAttribute('minlength');
  await expect(page.getByText(/Xirsys/i)).toHaveCount(0);
  await expect(page.locator('.diagnostics-drawer')).toHaveCount(0);
  await expect(page.getByText(/Checking device: \d+ of \d+ · up to \d+s remaining/)).toBeVisible();
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

  await page.getByText('Device checks', { exact: true }).click();
  await expect(page.getByText('TURN relay-only testing')).toBeVisible();
  await expect(page.getByText('Direct ICE-TCP isolated testing')).toBeVisible();
  await expect(
    page.getByText('STUN mapped-address discovery — stun.cloudflare.com:3478'),
  ).toBeVisible();
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
  expect(
    await page
      .locator('.diagnostics-drawer')
      .evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(800);
  await expect(page.locator('.diagnostics-drawer')).not.toHaveAttribute('aria-modal');
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await capture(page, 'desktop-diagnostics-drawer');
});

test('expired room access returns to actionable room controls', async ({ page }) => {
  await page.route('**/api/rooms/*/capabilities', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'forbidden' }),
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a room' }).click();

  await expect(page.getByRole('alert')).toContainText(/room expired|no longer has access/i, {
    timeout: 25_000,
  });
  await expect(page.getByRole('button', { name: 'Create a room' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join room' })).toBeVisible();
});

test('managed TURN exchanges an in-memory access code only after room authorization', async ({
  page,
  context,
}) => {
  const accessCode = 'invite-only-relay-code-1234';
  let credentialRequest:
    { authorization: string | undefined; body: { accessCode?: unknown } } | undefined;
  let delayNextCredentialResponse = false;
  let delayedRequestStarted = false;
  let releaseCredentialResponse: (() => void) | undefined;
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/rooms/*/turn-credentials', async (route) => {
    const request = route.request();
    credentialRequest = {
      authorization: request.headers().authorization,
      body: request.postDataJSON() as { accessCode?: unknown },
    };
    if (delayNextCredentialResponse) {
      delayedRequestStarted = true;
      await new Promise<void>((resolve) => {
        releaseCredentialResponse = resolve;
      });
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        iceServers: [
          {
            urls: ['turn:relay.example.test:3478?transport=udp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
        ],
      }),
    });
  });

  await page.goto('/');
  await page.getByLabel('TURN relay access code').fill(accessCode);
  await page.getByRole('button', { name: 'Create a room' }).click();

  await expect.poll(() => credentialRequest).toBeTruthy();
  expect(credentialRequest?.authorization).toMatch(/^Bearer pt_/);
  expect(credentialRequest?.body).toEqual({ accessCode });
  await expect(page.getByText('TURN relay is enabled for this tab.')).toBeVisible();
  await openDiagnostics(page);
  await page.getByRole('button', { name: 'Copy report' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain(accessCode);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(accessCode);
  await page.getByRole('button', { name: 'Close diagnostics' }).click();

  delayNextCredentialResponse = true;
  await page.getByLabel('TURN relay access code').fill('replacement-relay-code');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Apply relay code' }).click();
  await expect.poll(() => delayedRequestStarted).toBe(true);
  await page.getByRole('button', { name: 'Leave room' }).click();
  releaseCredentialResponse?.();

  await expect(page.getByRole('heading', { name: /Join room/ })).toBeVisible();
  await expect(page.getByLabel('TURN relay access code')).toHaveValue('');
  await expect(page.getByText('TURN relay is enabled for this tab.')).toHaveCount(0);
});

test('two devices auto-check, connect, exchange chat, finish the matrix, and render one report', async ({
  browser,
}) => {
  const coordinationRequests = { capabilities: 0, status: 0 };
  const attemptedProbeUrls = new Set<string>();
  const uploadedEvents: DiagnosticEvent[] = [];
  const hostContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const guestContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const countCoordinationRequest = (request: Request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && /^\/api\/runs\/[^/]+\/events$/.test(url.pathname)) {
      const batch = request.postDataJSON() as { events: DiagnosticEvent[] };
      uploadedEvents.push(...batch.events);
    }
    if (/\/probes\/[^/]+$/.test(url.pathname)) attemptedProbeUrls.add(url.pathname);
    if (request.method() === 'POST' && /\/api\/rooms\/[^/]+\/capabilities$/.test(url.pathname))
      coordinationRequests.capabilities++;
    if (request.method() === 'GET' && /\/api\/rooms\/[^/]+$/.test(url.pathname))
      coordinationRequests.status++;
  };
  hostContext.on('request', countCoordinationRequest);
  guestContext.on('request', countCoordinationRequest);
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
  await expect(host.locator('.participant-slot--connected')).toHaveCount(2);
  await expect(host.getByRole('heading', { name: 'Connection speed check' })).toBeVisible();

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
  await host.getByText('Connection checks', { exact: true }).click();
  const completedProbeUrls = [...attemptedProbeUrls].sort();
  await expect(host.locator('.capability-card')).toHaveCount(5);
  await expect(host.getByRole('table', { name: 'Direct pair details', exact: true })).toHaveCount(
    0,
  );
  await host.getByRole('button', { name: 'Pair details', exact: true }).click();
  const directPairs = host.getByRole('table', { name: 'Direct pair details', exact: true });
  await expect(directPairs).toBeVisible();
  await expect(directPairs).toContainText('Direct UDP');
  await expect(directPairs).toContainText('pass');
  await expect(directPairs).toContainText('host/udp');
  const statusHeading = directPairs.getByRole('columnheader', { name: 'Status', exact: true });
  expect((await statusHeading.boundingBox())!.width).toBeGreaterThanOrEqual(85);
  await directPairs.scrollIntoViewIfNeeded();
  await capture(host, 'desktop-capability-pair-details', false);
  await host.setViewportSize({ width: 390, height: 844 });
  await expect(directPairs).toBeVisible();
  expect(await host.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await directPairs.scrollIntoViewIfNeeded();
  await capture(host, 'mobile-capability-pair-details', false);
  await host.setViewportSize({ width: 1440, height: 900 });
  await host.getByRole('button', { name: 'Summary', exact: true }).click();
  await expect(directPairs).toHaveCount(0);
  expect([...attemptedProbeUrls].sort()).toEqual(completedProbeUrls);
  await host
    .locator('.diagnostics-drawer')
    .getByText('Connection speed check', { exact: true })
    .click();
  await expect(
    host.locator('.diagnostics-drawer').getByText(/Complete: RTT min\/median\/p95\/max/),
  ).toBeVisible({ timeout: 20_000 });
  expect(coordinationRequests.capabilities).toBe(2);
  const settledRequests = { ...coordinationRequests };
  await host.waitForTimeout(3_000);
  expect(coordinationRequests.capabilities).toBe(settledRequests.capabilities);
  expect(coordinationRequests.status - settledRequests.status).toBeLessThanOrEqual(1);
  await expect(
    host
      .locator('.diagnostics-drawer')
      .getByText(/MiB in \d+\.\d{2} s/)
      .first(),
  ).toBeVisible();
  await host.getByLabel('Test length (seconds)').fill('2');
  await host.getByLabel('Maximum per direction (MiB)').fill('8');
  await host.getByRole('button', { name: 'Restart speed check' }).click();
  await expect(host.getByRole('button', { name: 'Restart speed check' })).toBeHidden();
  await expect(host.getByRole('button', { name: 'Restart speed check' })).toBeVisible({
    timeout: 20_000,
  });
  await capture(host, 'desktop-connected-diagnostics');
  await host.getByRole('button', { name: 'Copy report' }).click();
  const copied = JSON.parse(await host.evaluate(() => navigator.clipboard.readText())) as {
    runId: string;
    attemptId: string;
    events: DiagnosticEvent[];
    matrix: Array<{
      id: string;
      outcome: string;
      pairs: Array<{
        a: string;
        b: string;
        outcome: string;
        attemptStatus: string;
        selected?: string;
      }>;
    }>;
    outcome: string;
  };
  expect(copied.runId).toMatch(/^run_/);
  expect(copied.attemptId).toBe(hostAttempt);
  expect(copied.matrix).toHaveLength(5);
  const candidateEvents = copied.events.filter((event) => event.type === 'candidate');
  expect(candidateEvents.length).toBeGreaterThan(0);
  const addressPattern = /(?:\d{1,3}\.){3}\d{1,3}|\.local\b|\[[0-9a-f:]+\]/i;
  expect(candidateEvents.some((event) => addressPattern.test(event.payload.message ?? ''))).toBe(
    true,
  );
  expect(
    candidateEvents.every(
      (event) =>
        event.attemptId === hostAttempt &&
        event.probeId?.startsWith('prb_') &&
        event.peerConnectionId &&
        event.elapsedMs >= 0,
    ),
  ).toBe(true);
  expect(copied.events.some((event) => event.type === 'stats')).toBe(true);
  expect(
    uploadedEvents.some(
      (event) => event.type === 'candidate' && addressPattern.test(event.payload.message ?? ''),
    ),
  ).toBe(true);
  const stun = copied.matrix.find((row) => row.id === 'stun-assisted')!;
  expect(stun.pairs.some((pair) => pair.a.includes('STUN stun.cloudflare.com:3478'))).toBe(true);
  expect(stun.pairs.some((pair) => pair.b.includes('STUN stun.cloudflare.com:3478'))).toBe(true);
  expect(copied.matrix.filter((row) => row.outcome === 'not-configured')).toHaveLength(3);
  const passedStunRows = stun.pairs.filter((pair) => pair.outcome === 'pass');
  expect(passedStunRows.length).toBeGreaterThan(0);
  expect(passedStunRows.every((pair) => /(?:srflx|prflx)/.test(pair.selected ?? ''))).toBe(true);
  expect(copied.outcome).toBe('Connected');
  await host.getByText('Event log and timing', { exact: true }).click();
  await expect(host.getByText(/Candidate IP addresses and mDNS names are included/)).toBeVisible();
  const earlierEvents = host.getByRole('button', { name: /Show earlier events/ });
  while (await earlierEvents.count()) await earlierEvents.click();
  await expect(host.locator('.event-list')).toContainText(candidateEvents[0]!.payload.message!);
  await capture(host, 'desktop-candidate-event-log', false);
  await host.setViewportSize({ width: 390, height: 844 });
  expect(
    await host
      .locator('.event-list')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect((await host.locator('.diagnostics-drawer').boundingBox())!.width).toBe(390);
  await capture(host, 'mobile-candidate-event-log', false);
  await host.setViewportSize({ width: 1440, height: 900 });
  await host.getByRole('button', { name: 'Compact report' }).click();
  const compact = host.getByRole('heading', { name: 'Connection summary' });
  await expect(compact).toBeVisible();
  await expect(host.locator('.compact-report')).toContainText(hostAttempt);
  await expect(host.locator('.compact-report')).toContainText('Connected');
  await capture(host, 'desktop-compact-report');

  await openDiagnostics(guest);
  await guest
    .locator('.diagnostics-drawer')
    .getByText('Connection speed check', { exact: true })
    .click();
  await expect(guest.getByLabel('Test length (seconds)')).toHaveValue('2');
  await expect(guest.getByLabel('Maximum per direction (MiB)')).toHaveValue('8');
  await expect(
    guest.locator('.diagnostics-drawer').getByText(/(?:[1-9]|1\d|20)\/20 answered/),
  ).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test('WebKit devices connect and exchange data without clipboard permissions', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'webkit');
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
  await Promise.all([
    expect(host.getByRole('heading', { name: 'Connected' })).toBeVisible({ timeout: 120_000 }),
    expect(guest.getByRole('heading', { name: 'Connected' })).toBeVisible({ timeout: 120_000 }),
  ]);
  await host.getByLabel('Write a message').fill('hello from WebKit host');
  await host.getByRole('button', { name: 'Send' }).click();
  await expect(guest.getByText('hello from WebKit host')).toBeVisible({ timeout: 10_000 });

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
