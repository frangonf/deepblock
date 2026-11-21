import { expect, test } from './fixtures';

test('renders and clicks a plain button without a GPU startup stall', async ({ page }) => {
  await page.setContent('<button onclick="this.textContent = \'Clicked\'">Ready</button>');
  await page.getByRole('button', { name: 'Ready' }).click({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Clicked' })).toBeVisible();
});
