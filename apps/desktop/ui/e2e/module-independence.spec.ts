import { expect, test } from './fixtures';

test('unavailable optional module status does not prevent saving a plan', async ({ page }) => {
  await page.route('**/modules', (route) => route.abort());
  await page.goto('/settings');
  await expect(page.getByText('Optional module status unavailable. Planning remains available.', { exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Planner', exact: true }).click();
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill('Independent planning');
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  const saved = page.waitForResponse((r) => r.url().includes('/plan/replan') && r.request().method() === 'POST');
  await page.getByTestId('planner-commit-replan').click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
});
