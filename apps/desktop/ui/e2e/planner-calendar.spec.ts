import { expect, test } from './fixtures';

test('a calendar block moves with the pointer and stays in the draft until saved', async ({ page, request }) => {
  const date = '2041-06-20';
  const planUrl = `http://127.0.0.1:8010/plan/${date}`;
  expect((await request.post(`http://127.0.0.1:8010/blocks?date=${date}`, {
    data: { label: 'Write proposal', start: '09:00', duration: 60, type: 'focus' },
  })).ok()).toBe(true);
  await page.goto(`/planner?date=${date}`);
  const calendar = page.getByTestId('planner-calendar');
  const event = calendar.getByRole('button', { name: /^Write proposal,/ });
  await event.scrollIntoViewIfNeeded();
  const box = (await event.boundingBox())!;
  const grid = (await calendar.locator('.sx__time-grid-day').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 12;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + grid.height / 48, { steps: 4 });
  await page.mouse.up();

  await expect(event).toHaveAccessibleName(/^Write proposal, 09:30 to 10:30,/);
  await expect(page.getByTestId('planner-inline-editor')).toHaveCount(0);
  const before = await (await request.get(planUrl)).json();
  expect(before.revisions.at(-1).blocks[0].start).toBe('09:00');
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const after = await (await request.get(planUrl)).json();
  expect(after.revisions.at(-1).blocks[0].start).toBe('09:30');
});

test('resizing previews displaced blocks before release and stages the result without opening an editor', async ({ page, request }) => {
  const date = '2041-06-21';
  for (const [label, start] of [['Focus session', '09:00'], ['Meeting', '10:00'], ['Follow-up', '11:00']]) {
    expect((await request.post(`http://127.0.0.1:8010/blocks?date=${date}`, {
      data: { label, start, duration: 60, type: 'focus' },
    })).ok()).toBe(true);
  }
  await page.goto(`/planner?date=${date}`);
  const calendar = page.getByTestId('planner-calendar');
  const focus = calendar.getByRole('button', { name: /^Focus session,/ });
  const handle = focus.locator('.sx__time-grid-event-resize-handle');
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const grid = (await calendar.locator('.sx__time-grid-day').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + grid.height / 96, { steps: 4 });

  const preview = calendar.getByTestId('calendar-gesture-preview');
  await expect(preview).toContainText(/Meeting.*10:15/);
  await expect(preview).toContainText(/Follow-up.*11:15/);
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.mouse.up();
  await expect(calendar.getByRole('button', { name: /^Follow-up, 11:15 to 12:15,/ })).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId('planner-inline-editor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo edit', exact: true }).click();
  await expect(focus).toHaveAccessibleName(/^Focus session, 09:00 to 10:00,/);
  await expect(calendar.getByRole('button', { name: /^Follow-up, 11:00 to 12:00,/ })).toBeVisible();
});

test('the calendar can create and reopen a block ending exactly at midnight', async ({ page, request }) => {
  const date = '2041-06-22';
  await page.goto(`/planner?date=${date}`);
  const calendar = page.getByTestId('planner-calendar');
  const column = calendar.getByTestId('planner-calendar-column');
  const grid = calendar.locator('.sx__time-grid-day');
  await expect(grid).toBeVisible();
  await column.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const box = (await grid.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 1425 / 1440);
  const editor = page.getByTestId('planner-inline-editor');
  await expect(editor.getByLabel('Start', { exact: true })).toHaveValue('23:45');
  await expect(editor.getByLabel('Duration (minutes)', { exact: true })).toHaveValue('15');
  await editor.getByLabel('Label', { exact: true }).fill('Finish day');
  await editor.getByRole('button', { name: 'Apply to draft' }).click();
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const result = await (await request.get(`http://127.0.0.1:8010/plan/${date}`)).json();
  expect(result.revisions.at(-1).blocks[0]).toMatchObject({ label: 'Finish day', start: '23:45', duration: 15 });
  const block = calendar.getByRole('button', { name: /^Finish day, 23:45 to 24:00,/ });
  await expect(block).toBeVisible();
  await block.click();
  await expect(editor.getByLabel('Label', { exact: true })).toHaveValue('Finish day');
});

test('keyboard editing preserves typed fields through a resize and a rejected time change', async ({ page, request }) => {
  const date = '2041-06-23';
  expect((await request.post(`http://127.0.0.1:8010/blocks?date=${date}`, {
    data: { label: 'Draft outline', start: '09:00', duration: 60, type: 'focus' },
  })).ok()).toBe(true);
  await page.goto(`/planner?date=${date}`);
  const block = page.getByRole('button', { name: /^Draft outline,/ });
  await block.press('Enter');
  const editor = page.getByTestId('planner-inline-editor');
  const label = editor.getByLabel('Label', { exact: true });
  await expect(label).toBeFocused();
  await label.fill('Typed outline');
  await page.setViewportSize({ width: 1080, height: 760 });
  await expect(label).toHaveValue('Typed outline');
  await editor.getByLabel('Start', { exact: true }).fill('23:45');
  await editor.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(editor.getByRole('alert')).toContainText('would end after 24:00');
  await expect(label).toHaveValue('Typed outline');
  await page.keyboard.press('Escape');
  await expect(block).toBeFocused();
  await expect(page.getByText('All changes saved')).toBeVisible();
});

test('saving and revisiting a day keeps the timeline at the same time', async ({ page, request }) => {
  const date = '2041-06-24';
  expect((await request.post(`http://127.0.0.1:8010/blocks?date=${date}`, {
    data: { label: 'Afternoon work', start: '15:00', duration: 60, type: 'focus' },
  })).ok()).toBe(true);
  await page.goto(`/planner?date=${date}`);
  const calendar = page.getByTestId('planner-calendar');
  const column = calendar.getByTestId('planner-calendar-column');
  await calendar.getByText('Afternoon work', { exact: true }).click();
  const editor = page.getByTestId('planner-inline-editor');
  await editor.getByLabel('Label', { exact: true }).fill('Updated afternoon work');
  await editor.getByRole('button', { name: 'Apply to draft' }).click();
  const before = await column.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(600);
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(before);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.getByLabel('Plan date')).toHaveValue('2041-06-25');
  await expect(calendar.locator('.sx__time-grid-day')).toHaveAttribute('aria-label', 'June 25, 2041');
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(calendar.getByText('Updated afternoon work', { exact: true })).toBeVisible();
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(before);
});

test('dragging to create follows scrolling and only stages a block after applying the editor', async ({ page }) => {
  await page.goto('/planner?date=2041-06-26');
  const calendar = page.getByTestId('planner-calendar');
  const grid = calendar.locator('.sx__time-grid-day');
  const column = calendar.getByTestId('planner-calendar-column');
  await expect(grid).toBeVisible();
  await column.evaluate((element) => { element.scrollTop = element.scrollHeight / 3; });
  const box = (await grid.boundingBox())!;
  const x = box.x + box.width / 2;
  const from = box.y + box.height * 9 / 24;
  const to = box.y + box.height * 10 / 24;
  const scrolled = await column.evaluate((element) => element.scrollTop);
  await page.mouse.move(x, from);
  await page.mouse.down();
  await page.mouse.move(x, to, { steps: 4 });
  await page.mouse.wheel(0, 90);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(scrolled + 90);
  await page.mouse.move(x + 2, to);
  await page.mouse.up();
  const editor = page.getByTestId('planner-inline-editor');
  await expect(editor.getByLabel('Start', { exact: true })).toHaveValue('09:00');
  await expect(editor.getByLabel('Duration (minutes)', { exact: true })).toHaveValue('105');
  await expect(page.getByText('All changes saved')).toBeVisible();
  await editor.getByLabel('Label', { exact: true }).fill('Extended slot');
  await editor.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(calendar.getByRole('button', { name: /^Extended slot, 09:00 to 10:45,/ })).toBeVisible();
  await expect(page.getByText('1 unsaved change')).toBeVisible();
});

test('touch scrolling leaves the draft alone and a held touch selects a block range', async ({ baseURL, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'This test sends native touch input through Chromium DevTools.');
  const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto('/planner?date=2041-06-27');
    const calendar = page.getByTestId('planner-calendar');
    const grid = calendar.locator('.sx__time-grid-day');
    const column = calendar.getByTestId('planner-calendar-column');
    await expect(grid).toBeVisible();
    await column.evaluate((element) => { element.scrollTop = element.scrollHeight / 3; });
    const client = await context.newCDPSession(page);
    const uid = 1;
    const gesture = async (x: number, y: number, dy: number, hold = 0) => {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: uid }] });
      if (hold) await new Promise((resolve) => setTimeout(resolve, hold));
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * fraction, id: uid }] });
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const original = (await grid.boundingBox())!;
    const x = original.x + original.width / 2;
    const before = await column.evaluate((element) => element.scrollTop);
    const visible = (await column.boundingBox())!;
    await gesture(x, visible.y + 200, -100);
    await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
    const editor = page.getByTestId('planner-inline-editor');
    await expect(editor).toHaveCount(0);

    // Start the range-selection check with a fresh timeline to clear swipe momentum.
    await page.reload();
    await expect(grid).toBeVisible();
    await column.evaluate((element) => { element.scrollTop = element.scrollHeight / 3; });
    const box = (await grid.boundingBox())!;
    await gesture(x, box.y + box.height * 9 / 24, box.height / 48, 450);
    await expect(editor.getByLabel('Start', { exact: true })).toHaveValue('09:00');
    await expect(editor.getByLabel('Duration (minutes)', { exact: true })).toHaveValue('30');
  } finally {
    await context.close();
  }
});

test('the timeline fits in a compact window and a pending save is in view', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 480 });
  await page.goto('/planner?date=2041-06-28');
  const column = page.getByTestId('planner-calendar-column');
  await expect(column).toBeInViewport({ ratio: 0.2 });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill('An unsaved commitment');
  await page.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page.getByTestId('planner-commit-replan')).toBeInViewport({ ratio: 1 });
  await expect(page.getByText('1 unsaved change')).toBeInViewport({ ratio: 1 });
});

test('calendar zoom preserves the visible time and the current draft', async ({ page }) => {
  await page.goto('/planner?date=2041-06-29');
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill('Retain this draft');
  await page.getByLabel('Start', { exact: true }).fill('13:00');
  await page.getByRole('button', { name: 'Apply to draft' }).click();
  const calendar = page.getByTestId('planner-calendar');
  const column = calendar.getByTestId('planner-calendar-column');
  const grid = calendar.locator('.sx__time-grid-day');
  const height = (await grid.boundingBox())!.height;
  await column.evaluate((element, position) => { element.scrollTop = position; }, height / 2);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await grid.boundingBox())?.height ?? 0).toBeGreaterThan(height);
  const zoomedHeight = (await grid.boundingBox())!.height;
  await expect.poll(async () => Math.round(await column.evaluate((element) => element.scrollTop) * 1440 / zoomedHeight)).toBe(720);
  await expect(calendar.getByRole('button', { name: /^Retain this draft, 13:00 to 14:00,/ })).toBeVisible();
  await expect(page.getByText('1 unsaved change')).toBeVisible();
});

test('planner shortcuts create and save a block without hijacking typing', async ({ page, request }) => {
  const date = '2041-06-30';
  await page.goto(`/planner?date=${date}`);
  await expect(page.getByRole('button', { name: 'Add block', exact: true })).toBeEnabled();
  await page.keyboard.press('c');
  const editor = page.getByRole('dialog', { name: 'Add block', exact: true });
  const label = editor.getByLabel('Label', { exact: true });
  await expect(label).toBeFocused();
  await page.keyboard.type('calendar shortcut');
  await expect(label).toHaveValue('calendar shortcut');
  await editor.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page.getByText('1 unsaved change')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByText('All changes saved')).toBeVisible();
  const saved = await (await request.get(`http://127.0.0.1:8010/plan/${date}`)).json();
  expect(saved.revisions.at(-1).blocks[0].label).toBe('calendar shortcut');
});

test('inline editing keeps scheduling fields upfront and optional details within reach', async ({ page, request }) => {
  const date = '2041-07-03';
  expect((await request.post(`http://127.0.0.1:8010/blocks?date=${date}`, {
    data: { label: 'Tidy planner', start: '09:00', duration: 60, type: 'focus' },
  })).ok()).toBe(true);
  await page.goto(`/planner?date=${date}`);
  await page.getByRole('button', { name: /^Tidy planner,/ }).press('Enter');
  const editor = page.getByTestId('planner-inline-editor');
  await expect(editor.getByLabel('Start', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Artifact path', { exact: true })).toBeHidden();
  await editor.getByText('Block details', { exact: true }).click();
  await editor.getByLabel('Next action', { exact: true }).fill('Review the calendar');
  await editor.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page.getByText('1 unsaved change')).toBeVisible();
  await page.getByRole('button', { name: /^Tidy planner,/ }).press('Enter');
  await editor.getByText('Block details', { exact: true }).click();
  await expect(editor.getByLabel('Next action', { exact: true })).toHaveValue('Review the calendar');
});

test('calendar and list share a draft, with explicit save and discard', async ({ page, request }) => {
  const label = `Shared draft ${Date.now()}`;
  // This test exercises a revision after an initial commitment; new-plan A
  // behavior is covered separately on an isolated future day.
  expect((await request.post('http://127.0.0.1:8010/blocks', { data: { label: `Initial anchor ${Date.now()}`, start: '06:00', duration: 15, type: 'focus' } })).ok()).toBe(true);
  await page.goto('/planner');
  await page.getByTestId('planner-view-list').click();
  const baseline = await (await request.get('http://127.0.0.1:8010/plan/today')).json();
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill(label);
  await page.getByLabel('Start', { exact: true }).fill('09:00');
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /unsaved change/ })).toBeVisible();
  const unchanged = await (await request.get('http://127.0.0.1:8010/plan/today')).json();
  expect(unchanged).toEqual(baseline);
  await page.getByTestId('planner-view-calendar').click();
  const event = page.locator('[data-testid="planner-calendar"] [data-testid="calendar-event"]').filter({ hasText: label });
  await expect(event).toBeVisible();
  await event.click();
  await page.getByLabel('Start', { exact: true }).fill('09:30');
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const saved = await (await request.get('http://127.0.0.1:8010/plan/today')).json();
  expect(saved.revisions.length).toBe(baseline.revisions.length + 1);
  expect(saved.revisions.at(-1).blocks.find((block: { label: string }) => block.label === label).start).toBe('09:30');
  await event.click();
  await page.getByLabel('Start', { exact: true }).fill('10:00');
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await page.getByTestId('planner-view-list').click();
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  await page.getByTestId('planner-discard-draft').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const afterDiscard = await (await request.get('http://127.0.0.1:8010/plan/today')).json();
  expect(afterDiscard).toEqual(saved);
  await page.getByTestId('planner-view-calendar').click();
  await page.getByRole('button', { name: 'Show history', exact: true }).click();
  await expect(page.getByTestId('calendar-resource-header')).toHaveCount(saved.revisions.length);
  await page.getByRole('button', { name: 'Hide history', exact: true }).click();
  await expect(page.getByTestId('calendar-resource-header')).toHaveCount(1);
});

test('history shows read-only revision columns aligned to the current timeline', async ({ page, request }) => {
  const date = '2041-07-10';
  const commit = async (label: string, start: string) => {
    const response = await request.post(`http://127.0.0.1:8010/plan/replan?date=${date}`, {
      data: { operations: [{ op: 'create', label, start, duration: 30, type: 'focus' }] },
    });
    expect(response.ok()).toBe(true);
  };
  await commit('Shared anchor', '12:00');
  await commit('Second revision block', '13:00');
  await commit('Current revision block', '14:00');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/planner?date=${date}`);
  const active = page.getByTestId('planner-calendar');
  const activeScroll = active.getByTestId('planner-calendar-column');
  await active.getByTestId('calendar-event').filter({ hasText: 'Shared anchor' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Show history', exact: true }).click();
  const strip = page.getByRole('region', { name: 'Plan revisions' });
  await expect(strip).toBeVisible({ timeout: 5000 });
  const previous = strip.getByRole('region', { name: 'Revision B', exact: true });
  const earliest = strip.getByRole('region', { name: 'Revision A', exact: true });
  const previousScroll = previous.getByTestId('planner-calendar-column');
  const earliestScroll = earliest.getByTestId('planner-calendar-column');
  await expect(previous.getByTestId('calendar-event').filter({ hasText: 'Second revision block' })).toHaveCount(1);
  await expect(earliest.getByTestId('calendar-event')).toHaveCount(1);
  await expect(active.getByTestId('calendar-event').filter({ hasText: 'Current revision block' })).toHaveCount(1);

  const position = (column: typeof activeScroll) => column.evaluate((element) => element.scrollTop);
  const initial = await position(activeScroll);
  expect(initial).toBeGreaterThan(0);
  await expect.poll(() => position(previousScroll)).toBe(initial);
  await expect.poll(() => position(earliestScroll)).toBe(initial);
  const currentAnchor = (await active.getByTestId('calendar-event').filter({ hasText: 'Shared anchor' }).boundingBox())!;
  const previousAnchor = (await previous.getByTestId('calendar-event').filter({ hasText: 'Shared anchor' }).boundingBox())!;
  const earliestAnchor = (await earliest.getByTestId('calendar-event').filter({ hasText: 'Shared anchor' }).boundingBox())!;
  expect(currentAnchor.x).toBeLessThan(previousAnchor.x);
  expect(previousAnchor.x).toBeLessThan(earliestAnchor.x);
  expect(previousAnchor.y).toBeCloseTo(currentAnchor.y, 0);
  expect(earliestAnchor.y).toBeCloseTo(currentAnchor.y, 0);

  await previousScroll.evaluate((element) => { element.scrollTop += 90; });
  const updated = await position(previousScroll);
  await expect.poll(() => position(activeScroll)).toBe(updated);
  await expect.poll(() => position(earliestScroll)).toBe(updated);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => position(activeScroll)).toBeCloseTo(updated * 1.25, -1);
  await expect.poll(async () => (await position(earliestScroll)) - (await position(activeScroll))).toBe(0);

  const readOnly = previous.getByTestId('calendar-event').filter({ hasText: 'Shared anchor' });
  await expect(readOnly.locator('.sx__time-grid-event-resize-handle')).toHaveCount(0);
  await readOnly.click();
  await expect(page.getByTestId('planner-inline-editor')).toHaveCount(0);

  const currentBlock = active.getByRole('button', { name: /^Current revision block,/ });
  await currentBlock.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const block = (await currentBlock.boundingBox())!;
  const grid = (await active.locator('.sx__time-grid-day').boundingBox())!;
  const x = block.x + block.width / 2;
  const y = block.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + grid.height / 48, { steps: 4 });
  await page.mouse.up();
  await expect(currentBlock).toHaveAccessibleName(/^Current revision block, 14:30 to 15:00,/);
});

test('late display settings keep calendar clicks aligned with the visible hours', async ({ page, request }) => {
  const date = '2041-07-01';
  const label = `Configured calendar ${Date.now()}`;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await gate;
    await route.fulfill({ response, json: { ...config, start_hour: 8, end_hour: 18 } });
  });
  try {
    await page.goto(`/planner?date=${date}`);
    await expect(page.locator('.sx__week-grid__hour-text').first()).toHaveText('00:00');
  } finally { release(); }

  await expect(page.locator('.sx__week-grid__hour-text').first()).toHaveText('08:00');
  const day = page.getByTestId('planner-calendar').locator('.sx__time-grid-day');
  const box = await day.boundingBox();
  // 09:00 is one hour into the configured ten-hour day.
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 10);
  const editor = page.getByTestId('planner-inline-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Start', { exact: true })).toHaveValue('09:00');
  await editor.getByLabel('Label', { exact: true }).fill(label);
  await editor.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  const saved = await (await request.get(`http://127.0.0.1:8010/plan/${date}`)).json();
  expect(saved.revisions.at(-1).blocks.find((block: { label: string }) => block.label === label).start).toBe('09:00');
});

test('live layout settings update the grid without discarding staged blocks', async ({ page, request }) => {
  const api = 'http://127.0.0.1:8010';
  const original = await (await request.get(`${api}/config`)).json();
  const label = `Retained during settings ${Date.now()}`;
  try {
    expect((await request.patch(`${api}/config`, { data: {
      start_hour: 0, end_hour: 24, pixels_per_minute: 2, rounding_interval: 15, time_format: '24h',
    } })).ok()).toBe(true);
    await page.goto('/planner?date=2041-07-02');
    await expect(page.locator('.sx__week-grid__hour-text').first()).toHaveText('00:00');
    await page.getByRole('button', { name: 'Add block', exact: true }).click();
    await page.getByLabel('Label', { exact: true }).fill(label);
    await page.getByLabel('Start', { exact: true }).fill('09:00');
    await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    const before = await page.locator('.sx__time-grid-day').boundingBox();
    expect((await request.patch(`${api}/config`, { data: {
      start_hour: 8, end_hour: 18, pixels_per_minute: 3, rounding_interval: 30, time_format: '12h',
    } })).ok()).toBe(true);
    await expect(page.locator('.sx__week-grid__hour-text').first()).toHaveText('8:00 AM');
    const after = await page.locator('.sx__time-grid-day').boundingBox();
    expect(after!.height).not.toBe(before!.height);
    await expect(page.locator('.sx__week-grid__hour-text').nth(1)).toHaveText('8:30 AM');
    await expect(page.getByTestId('planner-calendar').getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByTestId('planner-commit-replan')).toBeEnabled();
    const box = await page.locator('.sx__time-grid-day').boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 10);
    await expect(page.getByTestId('planner-inline-editor').getByLabel('Start', { exact: true })).toHaveValue('09:00');
  } finally {
    expect((await request.patch(`${api}/config`, { data: original })).ok()).toBe(true);
  }
});

test('planner is visible at desktop sizes and scrolled editors stay inside the viewport', async ({ page, request }) => {
  const label = `Scrolled editor ${Date.now()}`;
  const response = await request.post('http://127.0.0.1:8010/blocks', { data: { label, start: '17:00', duration: 60, type: 'focus' } });
  expect(response.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto('/planner');
  const calendar = page.getByTestId('planner-calendar');
  await expect(calendar).toBeVisible();
  const calendarBox = await calendar.boundingBox();
  expect(calendarBox!.y).toBeLessThan(400);
  const event = calendar.getByTestId('calendar-event').filter({ hasText: label });
  await event.scrollIntoViewIfNeeded();
  // Exercise a genuinely scrolled editor without assuming the current hour
  // makes the calendar's initial auto-scroll positive (it does not at midnight).
  await expect.poll(() => page.getByTestId('planner-calendar-column').evaluate((column) => column.scrollTop)).toBeGreaterThan(0);
  await event.click();
  const editor = page.getByTestId('planner-inline-editor');
  await expect(editor).toBeInViewport();
  const editorBox = await editor.boundingBox();
  expect(editorBox!.y).toBeGreaterThanOrEqual(0);
  expect(editorBox!.y + editorBox!.height).toBeLessThanOrEqual(720);
  expect(editorBox!.x).toBeGreaterThanOrEqual(0);
  expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(1024);
  await expect(editor.getByLabel('Label', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
});

test('block editors use available width without horizontal scrolling', async ({ page, request }) => {
  const date = '2045-07-01';
  const label = `Responsive editor ${Date.now()}`;
  expect((await request.post(`http://127.0.0.1:8010/blocks?date=${date}`, {
    data: { label, start: '08:00', duration: 60, type: 'shallow' },
  })).ok()).toBe(true);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 720 },
    { width: 640, height: 480 },
    { width: 480, height: 480 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/planner?date=${date}`);
    await page.evaluate(() => document.fonts.ready);
    const event = page.getByTestId('planner-calendar').getByTestId('calendar-event').filter({ hasText: label });
    await event.click();
    const editor = page.getByTestId('planner-inline-editor');
    await expect(editor).toBeVisible();
    expect(await editor.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const box = (await editor.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(Math.min(560, viewport.width - 32));
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 16);
    expect(box.y).toBeGreaterThanOrEqual(16);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 16);
    if (viewport.height === 900) {
      expect(await editor.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    }
    const startLabel = (await editor.getByLabel('Start', { exact: true }).locator('..').boundingBox())!;
    const durationLabel = (await editor.getByLabel('Duration (minutes)', { exact: true }).locator('..').boundingBox())!;
    expect(Math.abs(startLabel.y - durationLabel.y) < 1).toBe(viewport.width >= 480);
    await editor.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(editor).toBeHidden();

    await page.getByRole('button', { name: 'Add block', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Add block', exact: true });
    await expect(modal).toBeVisible();
    expect(await modal.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(modal).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
});

test('shared pages fit the minimum desktop window', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 480 });
  for (const route of ['planner', 'compare', 'reality', 'review', 'notes', 'backlog', 'settings', 'help']) {
    await page.goto(`/${route}`);
    await expect(page.locator('main > .grid')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), route).toBeLessThanOrEqual(1);
  }
});

test('calendar day and editability follow date navigation without a reload', async ({ page, request }) => {
  const label = `Future navigation ${Date.now()}`;
  const response = await request.post('http://127.0.0.1:8010/blocks?date=2035-05-01', {
    data: { label, start: '10:00', duration: 60, type: 'focus' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto('/planner?date=2024-02-29');
  const day = page.locator('[data-testid="planner-calendar"] .sx__time-grid-day');
  await expect(day).toHaveAttribute('aria-label', 'February 29, 2024');
  await expect(page.getByRole('button', { name: 'Add block', exact: true })).toBeDisabled();
  await page.getByLabel('Plan date', { exact: true }).fill('2035-05-01');
  await expect(day).toHaveAttribute('aria-label', 'May 1, 2035');
  await expect(page.getByRole('button', { name: 'Add block', exact: true })).toBeEnabled();
  const event = page.getByTestId('planner-calendar').getByTestId('calendar-event').filter({ hasText: label });
  await event.click();
  await expect(page.getByTestId('planner-inline-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(day).toHaveAttribute('aria-label', 'May 2, 2035');
  await expect(page.getByTestId('planner-calendar').getByText(label, { exact: true })).toHaveCount(0);
  // Revisiting a cached day keeps the planner mounted, unlike the loading
  // state on a first visit. Its calendar must still update the visible date.
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(day).toHaveAttribute('aria-label', 'May 1, 2035');
  await expect(page.getByTestId('planner-calendar').getByText(label, { exact: true })).toBeVisible();
});

test('clock labels retain 12-hour and 24-hour formatting at midnight and noon', async ({ page, request }) => {
  const api = 'http://127.0.0.1:8010';
  const original = await (await request.get(`${api}/config`)).json();
  const date = '2043-01-02';
  const cases = [
    { start: '00:30', finish: '01:00', shortStart: '12:30 AM', shortFinish: '1:00 AM' },
    { start: '12:00', finish: '12:30', shortStart: '12:00 PM', shortFinish: '12:30 PM' },
  ];
  try {
    expect((await request.patch(`${api}/config`, { data: { start_hour: 0, end_hour: 24, time_format: '24h' } })).ok()).toBe(true);
    for (const { start } of cases) {
      expect((await request.post(`${api}/blocks?date=${date}`, { data: { label: `Clock ${start}`, start, duration: 30, type: 'focus' } })).ok()).toBe(true);
    }
    await page.goto(`/planner?date=${date}`);
    const event = (start: string) => page.getByTestId('planner-calendar').getByTestId('calendar-event').filter({ hasText: `Clock ${start}` });
    for (const { start, finish } of cases) {
      await expect(event(start)).toHaveAttribute('aria-label', `Clock ${start}, ${start} to ${finish}, 30 min, focus, proposed`);
    }
    expect((await request.patch(`${api}/config`, { data: { time_format: '12h' } })).ok()).toBe(true);
    for (const { start, shortStart, shortFinish } of cases) {
      await expect(event(start)).toHaveAttribute('aria-label', `Clock ${start}, ${shortStart} to ${shortFinish}, 30 min, focus, proposed`);
    }
  } finally {
    expect((await request.patch(`${api}/config`, { data: original })).ok()).toBe(true);
  }
});
