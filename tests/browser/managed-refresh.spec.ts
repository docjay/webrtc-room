import { expect, test } from '@playwright/test';
import type { DiagnosticEvent } from '../../src/shared/domain.js';

for (const mode of ['rotated-host', 'http-error'] as const) {
  test(`managed refresh preserves endpoint evidence for ${mode}`, async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const events: DiagnosticEvent[] = [];
    let requests = 0;
    await host.addInitScript(() => {
      const urls: string[] = [];
      Object.defineProperty(window, '__observedTestIceUrls', { value: urls });
      window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
        construct(target, args: ConstructorParameters<typeof RTCPeerConnection>) {
          for (const server of args[0]?.iceServers ?? []) {
            urls.push(...(typeof server.urls === 'string' ? [server.urls] : server.urls));
          }
          return Reflect.construct(target, args);
        },
      });
    });
    host.on('request', (request) => {
      if (
        request.method() !== 'POST' ||
        !/\/api\/runs\/[^/]+\/events$/.test(new URL(request.url()).pathname)
      )
        return;
      events.push(...(request.postDataJSON() as { events: DiagnosticEvent[] }).events);
    });
    await host.route('**/turn-credentials', async (route) => {
      requests++;
      if (requests > 1 && mode === 'http-error') {
        await route.fulfill({
          status: 502,
          json: { error: 'password=upstream-private-detail' },
        });
        return;
      }
      await route.fulfill({
        json: {
          iceServers: [
            {
              urls: [
                `turn:${requests === 1 ? 'original' : 'refreshed'}.example.test:3478?transport=udp`,
              ],
              username: 'test-user',
              credential: 'test-secret',
            },
          ],
        },
      });
    });
    try {
      await host.goto('/');
      await host.getByLabel('TURN relay access code').fill('test-relay-code');
      await host.getByRole('button', { name: 'Create a room' }).click();
      await expect(host.getByRole('heading', { name: 'Waiting for the other device' })).toBeVisible(
        {
          timeout: 25_000,
        },
      );
      const code = ((await host.locator('.invitation-card strong').textContent()) ?? '').trim();
      await guest.goto(`/?room=${code}`);
      await guest.getByRole('button', { name: 'Join room' }).click();
      await expect.poll(() => requests, { timeout: 45_000 }).toBeGreaterThan(1);

      if (mode === 'rotated-host') {
        await expect
          .poll(
            () => host.evaluate(() => Reflect.get(window, '__observedTestIceUrls') as string[]),
            { timeout: 15_000 },
          )
          .toContain('turn:refreshed.example.test:3478?transport=udp');
        await expect
          .poll(() => events.map((event) => event.payload.message ?? '').join('\n'))
          .toContain('refreshed.example.test');
      } else {
        await expect
          .poll(() => events.map((event) => event.payload.message ?? '').join('\n'), {
            timeout: 15_000,
          })
          .toContain('502');
      }
      expect(JSON.stringify(events)).not.toMatch(/test-secret|upstream-private-detail/);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
}
