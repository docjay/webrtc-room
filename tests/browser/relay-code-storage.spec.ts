import { expect, test } from '@playwright/test';
import { TURN_CODE_STORAGE_KEY } from '../../src/client/relay-code-storage.js';

test('remembers a readable TURN code across reloads and tabs, and forgets it when cleared', async ({
  page,
  context,
}) => {
  let credentialRequests = 0;
  await context.route('**/turn-credentials', async (route) => {
    credentialRequests++;
    await route.fulfill({ status: 403, json: { error: 'room authorization required' } });
  });
  await page.goto('/');
  const code = page.getByLabel('TURN relay access code');
  await expect(code).toHaveAttribute('type', 'text');
  await code.fill('saved-relay-fixture');
  expect(await page.evaluate((key) => localStorage.getItem(key), TURN_CODE_STORAGE_KEY)).toBe(
    'saved-relay-fixture',
  );
  await page.reload();
  await expect(code).toHaveValue('saved-relay-fixture');
  const nextTab = await context.newPage();
  await nextTab.goto('/');
  await expect(nextTab.getByLabel('TURN relay access code')).toHaveValue('saved-relay-fixture');
  expect(credentialRequests).toBe(0);
  await nextTab.getByLabel('TURN relay access code').fill('');
  expect(
    await nextTab.evaluate((key) => localStorage.getItem(key), TURN_CODE_STORAGE_KEY),
  ).toBeNull();
  await page.reload();
  await expect(code).toHaveValue('');
  await nextTab.close();
});

test('keeps the TURN code editable and surfaces blocked browser storage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('storage blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Could not load the saved TURN code');
  const code = page.getByLabel('TURN relay access code');
  await code.fill('tab-only-fixture');
  await expect(code).toHaveValue('tab-only-fixture');
  await expect(page.getByRole('alert')).toContainText('Could not save the TURN code');
  await code.fill('');
  await expect(page.getByRole('alert')).toContainText('Could not remove the saved TURN code');
});
