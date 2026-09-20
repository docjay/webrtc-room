import { expect, test } from '@playwright/test';
import { installRelayStatsFixture } from './relay-fixture.js';

for (const mode of [
  'verified',
  'missing-protocol',
  'missing-link',
  'mismatch',
  'blocked-ping',
  'no-relay',
] as const) {
  const connected = mode !== 'blocked-ping' && mode !== 'no-relay';
  const name = connected
    ? `retains relay connectivity with Device B ${mode} evidence`
    : `rejects relay connectivity with ${mode}`;
  test(name, async ({ browser }) => {
    const hostContext = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const guestContext = await browser.newContext();
    await installRelayStatsFixture(hostContext, mode === 'no-relay' ? 'no-relay' : 'verified');
    await installRelayStatsFixture(
      guestContext,
      mode === 'blocked-ping' || mode === 'no-relay' ? 'verified' : mode,
    );
    if (mode === 'blocked-ping') {
      await guestContext.addInitScript(() => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply preserves the native receiver.
        RTCDataChannel.prototype.send = new Proxy(RTCDataChannel.prototype.send, {
          apply(send, channel: RTCDataChannel, args: unknown[]) {
            if (typeof args[0] === 'string' && args[0].startsWith('probe-ping:')) return;
            Reflect.apply(send, channel, args);
          },
        });
      });
    }
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    for (const [index, page] of [host, guest].entries()) {
      let credentialRequests = 0;
      await page.route('**/turn-credentials', async (route) => {
        credentialRequests++;
        await route.fulfill({
          json: {
            iceServers: [
              {
                urls: [
                  `turn:${credentialRequests === 1 ? 'requested' : `actual-${index}`}.example.test:80?transport=${mode === 'no-relay' ? 'tcp' : 'udp'}`,
                ],
                username: 'relay-fixture-user',
                credential: 'relay-fixture-credential',
              },
            ],
          },
        });
      });
      await page.route('**/api/signals/**', async (route) => {
        const pair = new URL(route.request().url()).searchParams.get('pair');
        if (pair === 'pair-direct-0' || pair === 'pair-stun-assisted-0') {
          await route.fulfill({
            status: 503,
            json: { error: 'non-relay path disabled in fixture' },
          });
          return;
        }
        if (mode === 'no-relay' && route.request().method() === 'POST') {
          const input = route.request().postDataJSON() as { body: { type: string } };
          if (input.body.type === 'candidate') {
            await route.fulfill({ json: { accepted: true } });
            return;
          }
        }
        await route.continue();
      });
    }
    try {
      await host.goto('/');
      await host.getByLabel('TURN relay access code').fill('relay-fixture-code');
      await host.getByRole('button', { name: 'Create a room' }).click();
      await expect(host.getByRole('heading', { name: 'Waiting for the other device' })).toBeVisible(
        {
          timeout: 25_000,
        },
      );
      const code = ((await host.locator('.invitation-card strong').textContent()) ?? '').trim();
      await guest.goto(`/?room=${code}`);
      await guest.getByLabel('TURN relay access code').fill('relay-fixture-code');
      await guest.getByRole('button', { name: 'Join room' }).click();
      for (const page of [host, guest]) {
        await expect(
          connected
            ? page.getByRole('heading', { name: 'Connected', exact: true })
            : page.getByText('Unable to connect', { exact: true }),
        ).toBeVisible({
          timeout: 45_000,
        });
        if (connected)
          await expect(page.getByText('Unable to connect', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Network checks: 5 of 5 complete')).toBeVisible();
        await page.getByRole('button', { name: /diagnostics/i }).click();
        await page.getByText('Connection checks', { exact: true }).click();
        const relay = page.locator('.capability-card').filter({
          has: page.getByText(mode === 'no-relay' ? 'TURN TCP' : 'TURN UDP', { exact: true }),
        });
        if (connected) {
          await expect(relay).toContainText('Relay connectivity: passed');
          await expect(relay).toContainText(
            mode === 'verified'
              ? 'verified on every required relay side'
              : mode === 'mismatch'
                ? 'mismatch'
                : 'verification unavailable',
          );
          await expect(page.locator('.room-performance')).toContainText(
            'speed checks are disabled on TURN relay paths',
          );
        } else {
          await expect(relay).not.toContainText('Relay connectivity: passed');
          await expect(relay).toContainText(
            mode === 'no-relay'
              ? 'No TURN relay candidate was observed'
              : 'application ping timed out',
          );
        }
        await page.getByRole('button', { name: 'Close diagnostics' }).click();
      }
      if (connected) {
        await host.getByLabel('Write a message').fill(`working relay fixture ${mode}`);
        await host.getByRole('button', { name: 'Send' }).click();
        await expect(guest.getByText(`working relay fixture ${mode}`)).toBeVisible();
      }
      await host.getByRole('button', { name: /diagnostics/i }).click();
      await host.getByRole('button', { name: 'Copy report', exact: true }).click();
      const report = JSON.parse(await host.evaluate(() => navigator.clipboard.readText())) as {
        outcome: string;
        matrix: Array<{
          id: string;
          outcome: string;
          connectivity?: string;
          protocolVerification?: string;
          detail?: string;
        }>;
      };
      const relay = report.matrix.find(
        (row) => row.id === (mode === 'no-relay' ? 'turn-tcp' : 'turn-udp'),
      );
      expect(report.outcome).toBe(connected ? 'Connected' : 'Unable to connect');
      if (connected) {
        expect(relay).toMatchObject({
          outcome: 'pass',
          connectivity: 'pass',
          protocolVerification:
            mode === 'verified' ? 'verified' : mode === 'mismatch' ? 'mismatch' : 'unavailable',
        });
      } else {
        expect(relay?.outcome).toMatch(/^(failure|timeout)$/);
        expect(relay?.connectivity).toMatch(/^(failure|timeout)$/);
        if (mode === 'no-relay') expect(relay?.outcome).toBe('timeout');
      }
      expect(relay?.detail).toContain('actual-0.example.test');
      expect(relay?.detail).toContain('actual-1.example.test');
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
}
