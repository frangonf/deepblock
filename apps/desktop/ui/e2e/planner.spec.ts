import { expect, test } from './fixtures';

test('planner supports add, artifact, and revise flows', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const blockLabel = `Deep Work ${suffix}`;
  const artifact = `https://example.com/${suffix}`;
  const activeRevision = page.getByTestId('revision-column');

  await page.goto('/planner');
  await page.getByTestId('planner-view-list').click();

  await page.getByRole('button', { name: 'Add block' }).click();
  await page.getByLabel('Label').fill(blockLabel);
  await page.getByLabel('Duration (minutes)').fill('90');
  await page.getByRole('button', { name: 'Apply to draft' }).click();

  await expect(page.getByText(blockLabel)).toBeVisible();

  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.getByRole('button', { name: 'Artifacts' }).first().click();
  await page.getByPlaceholder('https://github.com/... or docs/notes.md').fill(artifact);
  await page.getByRole('button', { name: 'Add artifact' }).click();
  await expect(page.getByRole('dialog').getByText(artifact)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  const previousRevision = await activeRevision.getAttribute('data-revision-id');
  await page.getByLabel('Plan actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Revise', exact: true }).click();
  await page.getByLabel('Reason').fill(`Need revision ${suffix}`);
  await page.getByRole('button', { name: 'Create revision' }).click();

  await expect.poll(() => activeRevision.getAttribute('data-revision-id')).not.toBe(previousRevision);

  await page.getByRole('button', { name: 'Show history' }).click();
  await expect.poll(async () => page.getByTestId('revision-column').count()).toBeGreaterThan(1);
});
