import { test, expect } from './fixtures';

test('activates browser mutations before application scripts run', async ({ page }) => {
  test.skip(process.env.DEEPBLOCK_MUTATION_E2E !== '1', 'Only used by local mutation testing');
  await page.route('**/mutation-bootstrap', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<script>window.mutationAtStartup = globalThis.__stryker__?.activeMutant;</script>',
  }));
  await page.goto('/mutation-bootstrap');
  const actual = await page.evaluate(() => (window as Window & { mutationAtStartup?: string }).mutationAtStartup);
  expect(actual).toBe(process.env.__STRYKER_ACTIVE_MUTANT__);
});
