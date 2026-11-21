import { expect, test } from './fixtures';

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
