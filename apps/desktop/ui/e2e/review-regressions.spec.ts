import { expect, test, type Page, type APIRequestContext } from './fixtures';

const api = 'http://127.0.0.1:8010';
async function seed(request: APIRequestContext, label: string) {
  const response = await request.post(`${api}/blocks`, { data: { label, start: '14:00', duration: 30, type: 'focus', focus_rating: 1 } });
  expect(response.ok()).toBeTruthy();
  const plan = await response.json();
  return plan.revisions.at(-1).blocks.find((block: { label: string }) => block.label === label).id as string;
}
async function edit(page: Page, label: string, nextLabel: string) {
  await page.locator('[data-testid="planner-calendar"] [data-testid="calendar-event"]').filter({ hasText: label }).first().click();
  await page.getByTestId('planner-inline-editor').waitFor();
  await page.getByLabel('Label', { exact: true }).fill(nextLabel);
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /unsaved change/ })).toBeVisible();
}

test('dirty drafts survive remote edits and explicitly rebase without clobbering metadata', async ({ page, request }) => {
  const label = `Conflict ${Date.now()}`;
  const id = await seed(request, label);
  await page.goto('/planner');
  await edit(page, label, `${label} local`);
  await page.getByRole('navigation').getByRole('link', { name: 'Notes', exact: true }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Planner', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /unsaved change/ })).toBeVisible();
  const response = await request.patch(`${api}/blocks/${id}`, { data: { label: `${label} remote`, focus_rating: 5 } });
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId('planner-draft-conflict')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('status').filter({ hasText: /unsaved change/ })).toBeVisible();
  await expect(page.getByTestId('planner-commit-replan')).toBeDisabled();
  await expect(page.locator('[data-testid="planner-calendar"]').getByText(`${label} local`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply edits to latest plan', exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().includes('/plan/replan') && response.request().method() === 'POST');
  await page.getByTestId('planner-commit-replan').click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByRole('status').filter({ hasText: /unsaved change/ })).toBeHidden();
  const plan = await (await request.get(`${api}/plan/today`)).json();
  const block = plan.revisions.at(-1).blocks.find((block: { id: string }) => block.id === id);
  expect(block.label).toBe(`${label} local`);
  expect(block.focus_rating).toBe(5);
});

test('calendar editing is frozen while a commit is in flight', async ({ page, request }) => {
  const label = `In flight ${Date.now()}`;
  await seed(request, label);
  await page.goto('/planner');
  await edit(page, label, `${label} staged`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/plan/replan*', async (route) => { await gate; await route.continue(); });
  try {
    await page.getByTestId('planner-commit-replan').click();
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible();
    await page.getByRole('navigation').getByRole('link', { name: 'Notes', exact: true }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Planner', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add block', exact: true })).toBeDisabled();
    await page.locator('[data-testid="planner-calendar"] [data-testid="calendar-event"]').filter({ hasText: label }).first().click();
    await expect(page.getByTestId('planner-inline-editor')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add block', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('status').filter({ hasText: /unsaved change/ })).toBeHidden();
});

test('saving a day preserves another retained draft after browser back navigation', async ({ page, request }) => {
  const firstDate = '2040-06-01';
  const secondDate = '2040-06-02';
  const firstLabel = `First day ${Date.now()}`;
  const secondLabel = `Second day ${Date.now()}`;
  const stage = async (label: string) => {
    await page.getByRole('button', { name: 'Add block', exact: true }).click();
    await page.getByLabel('Label', { exact: true }).fill(label);
    await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  };
  await page.goto(`/planner?date=${firstDate}`);
  await stage(firstLabel);
  await page.getByTestId('selected-date').fill(secondDate);
  await stage(secondLabel);
  await page.getByTestId('selected-date').fill(firstDate);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/plan/replan*', async (route) => { await gate; await route.continue(); });
  try {
    await page.getByTestId('planner-commit-replan').click();
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('selected-date')).toHaveValue(secondDate);
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible();
  } finally { release(); }

  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeHidden();
  await expect(page.getByTestId('planner-commit-replan')).toBeEnabled();
  await expect(page.getByTestId('planner-calendar').getByText(secondLabel, { exact: true })).toBeVisible();
  const saved = await (await request.get(`${api}/plan/${firstDate}`)).json();
  expect(saved.revisions.at(-1).blocks.some((block: { label: string }) => block.label === firstLabel)).toBe(true);
  const untouched = await (await request.get(`${api}/plan/${secondDate}`)).json();
  expect(untouched.revisions.at(-1).blocks).toHaveLength(0);
  await page.getByTestId('selected-date').fill(firstDate);
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.getByTestId('planner-calendar').getByText(firstLabel, { exact: true })).toBeVisible();
});

test('list creation retains every field exposed in the form', async ({ page, request }) => {
  const label = `Complete fields ${Date.now()}`;
  await page.goto('/planner');
  await page.getByTestId('planner-view-list').click();
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill(label);
  await page.getByLabel('Start', { exact: true }).fill('16:00');
  await page.getByRole('dialog').locator('select').nth(1).selectOption('done');
  await page.getByLabel('Focus rating', { exact: true }).fill('4');
  await page.getByLabel('Next action', { exact: true }).fill('Ship');
  await page.getByLabel('Artifact path', { exact: true }).fill('work.md');
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const plan = await (await request.get(`${api}/plan/today`)).json();
  const block = plan.revisions.at(-1).blocks.find((block: { label: string }) => block.label === label);
  expect(block).toMatchObject({ status: 'done', focus_rating: 4, next_action: 'Ship', content_path: 'work.md' });
});
