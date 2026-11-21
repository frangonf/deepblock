import { expect, test } from './fixtures';

test('planner supports drag and drop reordering in the active revision', async ({ page, request }) => {
  const suffix = Date.now().toString().slice(-6);
  const firstLabel = `Drag First ${suffix}`;
  const secondLabel = `Drag Second ${suffix}`;

  await page.goto('/planner');
  await page.getByTestId('planner-view-list').click();

  await page.getByRole('button', { name: 'Add block' }).click();
  await page.getByLabel('Label').fill(firstLabel);
  await page.getByLabel('Start').fill('09:00');
  await page.getByLabel('Duration (minutes)').fill('60');
  await page.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page.getByText(firstLabel)).toBeVisible();

  await page.getByRole('button', { name: 'Add block' }).click();
  await page.getByLabel('Label').fill(secondLabel);
  await page.getByLabel('Start').fill('10:00');
  await page.getByLabel('Duration (minutes)').fill('60');
  await page.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page.getByText(secondLabel)).toBeVisible();

  const activeRevision = page.locator('[data-testid="revision-column"]').last();
  const firstBlock = activeRevision.locator(`[data-testid="planner-block"]:has-text("${firstLabel}")`);
  const firstHandle = firstBlock.getByTitle('Drag to reorder');
  const totalBlocks = await activeRevision.locator('[data-testid="planner-block"]').count();
  const dropTarget = activeRevision.locator(`[data-drop-index="${totalBlocks}"]`);

  await expect(firstHandle).toBeVisible();
  await expect(dropTarget).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await firstHandle.dispatchEvent('dragstart', { dataTransfer });
  await dropTarget.dispatchEvent('dragover', { dataTransfer });
  await dropTarget.dispatchEvent('drop', { dataTransfer });
  await firstHandle.dispatchEvent('dragend', { dataTransfer });

  await expect
    .poll(async () => {
      const labels = await activeRevision.locator('[data-testid="planner-block"] h3').allTextContents();
      const firstIndex = labels.indexOf(firstLabel);
      const secondIndex = labels.indexOf(secondLabel);
      return firstIndex > secondIndex && secondIndex >= 0;
    })
    .toBe(true);
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const saved = await (await request.get('http://127.0.0.1:8010/plan/today')).json();
  const labels = saved.revisions.at(-1).blocks.map((block: { label: string }) => block.label);
  expect(labels.indexOf(firstLabel)).toBeGreaterThan(labels.indexOf(secondLabel));
});
