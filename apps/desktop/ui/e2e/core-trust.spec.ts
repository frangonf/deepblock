import { expect, test } from './fixtures';

const api = 'http://127.0.0.1:8010';

test('notes autosave through navigation and recover failed edits after reload', async ({ page, request }) => {
  const date = '2042-06-01';
  const original = `Reflection ${Date.now()}`;
  const recovered = `${original} recovered`;
  await page.goto(`/notes?date=${date}`);
  await expect(page.getByTestId('notes-editor')).toBeEnabled();
  await page.getByTestId('notes-editor').fill(original);
  await page.getByRole('navigation').getByRole('link', { name: 'Planner', exact: true }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Notes', exact: true }).click();
  await expect(page.getByTestId('notes-editor')).toHaveValue(original);
  const content = async () => (await (await request.get(`${api}/notes/${date}`)).json()).content;
  await expect.poll(content).toBe(original);
  await page.reload();
  await expect(page.getByTestId('notes-editor')).toHaveValue(original);

  const pattern = `**/notes/${date}`;
  await page.route(pattern, async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 503, json: { detail: 'Disk unavailable' } });
    else await route.continue();
  });
  await page.getByTestId('notes-editor').fill(recovered);
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByTestId('notes-editor')).toHaveValue(recovered);
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await page.unroute(pattern);
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect.poll(content).toBe(recovered);
  await expect(page.getByRole('status')).toHaveText('Saved');
});

test('first commitment is A and later revisions compare against it with an optional reason', async ({ page, request }) => {
  const date = '2042-06-02';
  const label = `Initial commitment ${Date.now()}`;
  await page.goto(`/planner?date=${date}`);
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill(label);
  await page.getByLabel('Start', { exact: true }).fill('09:00');
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await page.getByLabel('Draft actions', { exact: true }).click();
  await page.getByLabel('Reason (optional)').fill('Morning intention');
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const initial = await (await request.get(`${api}/plan/${date}`)).json();
  expect(initial.revisions).toHaveLength(1);
  expect(initial.revisions[0]).toMatchObject({ id: 'A', reason: 'Morning intention' });

  await page.getByTestId('planner-calendar').getByTestId('calendar-event').filter({ hasText: label }).click();
  await page.getByLabel('Start', { exact: true }).fill('10:00');
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await page.getByLabel('Draft actions', { exact: true }).click();
  await page.getByLabel('Reason (optional)').fill('Meeting shifted the morning');
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const revised = await (await request.get(`${api}/plan/${date}`)).json();
  expect(revised.revisions).toHaveLength(2);
  expect(revised.revisions[0]).toEqual(initial.revisions[0]);
  expect(revised.revisions[1]).toMatchObject({ id: 'B', reason: 'Meeting shifted the morning' });
  await page.goto(`/compare?date=${date}`);
  await expect(page.getByTestId('compare-summary')).toHaveText('0 added, 0 removed, 1 modified');
  await expect(page.getByText('Start time: 09:00 → 10:00')).toBeVisible();
});

test('equal-start ripple preview matches the persisted plan and ignores cancelled blocks', async ({ page, request }) => {
  const date = '2042-06-03';
  const suffix = Date.now();
  const alpha = `Alpha ${suffix}`;
  const zebra = `Zebra ${suffix}`;
  const moved = `Moved ${suffix}`;
  const cancelled = `Cancelled ${suffix}`;
  for (const data of [
    { label: zebra, start: '09:00', duration: 30 },
    { label: alpha, start: '09:00', duration: 30 },
    { label: moved, start: '08:00', duration: 60 },
    { label: cancelled, start: '09:00', duration: 480, status: 'cancelled' },
  ]) expect((await request.post(`${api}/blocks?date=${date}`, { data: { ...data, type: 'focus' } })).ok()).toBe(true);
  const config = await (await request.get(`${api}/config`)).json();
  try {
    expect((await request.patch(`${api}/config`, { data: { time_format: '24h' } })).ok()).toBe(true);
    await page.goto(`/planner?date=${date}`);
    await page.getByTestId('planner-calendar').getByTestId('calendar-event').filter({ hasText: moved }).click();
    await page.getByLabel('Start', { exact: true }).fill('09:00');
    await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    const events = page.getByTestId('planner-calendar').locator('.sx__time-grid-event');
    await expect(events.filter({ hasText: alpha })).toHaveAttribute('aria-label', /10:00/);
    await expect(events.filter({ hasText: zebra })).toHaveAttribute('aria-label', /10:30/);
    await page.getByTestId('planner-commit-replan').click();
    await expect(page.getByText('All changes saved')).toBeVisible();
    const plan = await (await request.get(`${api}/plan/${date}`)).json();
    for (const [label, start] of [[alpha, '10:00'], [zebra, '10:30'], [moved, '09:00'], [cancelled, '09:00']]) {
      expect(plan.revisions.at(-1).blocks.find((block: { label: string }) => block.label === label).start).toBe(start);
    }
  } finally {
    expect((await request.patch(`${api}/config`, { data: { time_format: config.time_format } })).ok()).toBe(true);
  }
});

test('historical reflection records outcomes without rewriting the plan or creating revisions', async ({ page, request }) => {
  const date = '2020-06-04';
  const label = `Historical reflection ${Date.now()}`;
  const created = await request.post(`${api}/blocks?date=${date}`, { data: { label, start: '09:00', duration: 60, type: 'focus' } });
  expect(created.ok()).toBe(true);
  const before = await created.json();
  const block = before.revisions.at(-1).blocks.find((block: { label: string }) => block.label === label);
  await page.goto(`/review?date=${date}`);
  await page.getByRole('button', { name: `Record outcome for ${label}` }).click();
  await page.getByLabel('Actual minutes', { exact: true }).fill('95');
  await page.getByLabel('Focus rating', { exact: true }).fill('3');
  await page.getByLabel('Completion', { exact: true }).selectOption('true');
  await page.getByRole('button', { name: 'Save outcome', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const after = await (await request.get(`${api}/plan/${date}`)).json();
  expect(after.revisions).toHaveLength(before.revisions.length);
  expect(after.revisions.at(-1).blocks.find((candidate: { id: string }) => candidate.id === block.id)).toMatchObject({
    id: block.id, start: block.start, duration: block.duration, type: block.type, status: block.status,
    actual_duration: 95, focus_rating: 3, metadata: { outcome_completed: true },
  });
  await expect(page.getByTestId('review-coverage')).toContainText('1 of 1 blocks');
});
