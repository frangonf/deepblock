import { expect, test } from "./fixtures";

const api = "http://127.0.0.1:8010";

test("selected day survives navigation and historical reviews do not claim success without evidence", async ({
  page,
  request,
}) => {
  const date = "2024-02-29";
  const label = `Historical ${Date.now()}`;
  expect(
    (
      await request.post(`${api}/blocks?date=${date}`, {
        data: { label, start: "09:00", duration: 60, type: "focus" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/planner?date=${date}`);
  await expect(page.getByTestId("selected-date")).toHaveValue(date);
  await expect(
    page.getByRole("button", { name: "Add block", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Compare", exact: true })
    .click();
  await expect(page.getByTestId("selected-date")).toHaveValue(date);
  await expect(page.getByText("Nothing to compare yet")).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Review", exact: true })
    .click();
  await expect(page.getByTestId("selected-date")).toHaveValue(date);
  await expect(page.getByText("No recorded evidence yet")).toBeVisible();
  await expect(page.getByText("Not assessed", { exact: true })).toHaveCount(3);
  await expect(page.getByTestId("review-coverage")).toContainText(
    "0 of 1 blocks",
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Reality", exact: true })
    .click();
  await expect(page.getByTestId("selected-date")).toHaveValue(date);
  await expect(
    page.getByRole("button", { name: "Run audit", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Notes", exact: true })
    .click();
  await expect(page.getByTestId("selected-date")).toHaveValue(date);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Planner", exact: true })
    .click();
  await expect(page.getByTestId("selected-date")).toHaveValue(date);
});

test("short calendar blocks keep their label and accessible details at desktop sizes", async ({
  page,
  request,
}) => {
  const label = `Short block ${Date.now()}`;
  expect(
    (
      await request.post(`${api}/blocks`, {
        data: { label, start: "08:00", duration: 15, type: "break" },
      })
    ).ok(),
  ).toBeTruthy();
  for (const viewport of [
    { width: 1024, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/planner");
    const event = page
      .getByTestId("planner-calendar")
      .getByTestId("calendar-event")
      .filter({ hasText: label });
    await expect(event).toBeVisible();
    await event.scrollIntoViewIfNeeded();
    await expect(event.locator(".planner-event__title")).toBeVisible();
    await expect(event).toHaveAttribute("title", /15 min · break · proposed/);
    await expect(event.locator(".planner-event__metadata")).toBeHidden();
    await expect(page.locator(".planner-time-label--hour").first()).toHaveText(
      "00:00",
    );
    const keyboardTarget = event.locator(
      "xpath=ancestor::*[@data-event-id][1]",
    );
    await expect(keyboardTarget).toHaveAttribute("role", "button");
    await expect(keyboardTarget).toHaveAttribute(
      "aria-label",
      new RegExp(label),
    );
    await event.click();
    await expect(page.getByTestId("planner-inline-editor")).toBeInViewport();
    await page.keyboard.press("Escape");
  }
});

test("backlog tasks enter the plan as drafts and can be completed in one list action", async ({
  page,
  request,
}) => {
  const label = `Schedule from backlog ${Date.now()}`;
  await page.goto("/backlog");
  await page.getByTestId("backlog-input").fill(label);
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("link", { name: "Schedule today", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Label", { exact: true })).toHaveValue(label);
  await page
    .getByRole("button", { name: "Apply to draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /unsaved change/ }),
  ).toBeVisible();
  const unchanged = await (await request.get(`${api}/plan/today`)).json();
  expect(
    unchanged.revisions
      .at(-1)
      .blocks.some((block: { label: string }) => block.label === label),
  ).toBe(false);
  await page.getByTestId("planner-commit-replan").click();
  await expect(
    page.getByRole("status").filter({ hasText: "All changes saved" }),
  ).toBeVisible();
  await page.getByTestId("planner-view-list").click();
  const row = page
    .locator('[data-testid="planner-block"]')
    .filter({ hasText: label });
  await row.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect(row.getByText("done", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /unsaved change/ }),
  ).toBeVisible();
  await page.getByTestId("planner-commit-replan").click();
  await expect(
    page.getByRole("status").filter({ hasText: "All changes saved" }),
  ).toBeVisible();
  const saved = await (await request.get(`${api}/plan/today`)).json();
  expect(
    saved.revisions
      .at(-1)
      .blocks.find((block: { label: string }) => block.label === label).status,
  ).toBe("done");
});

test('semantic themes preserve readable action states and independent status colours', async ({ page, request }) => {
  const label = `Theme sample ${Date.now()}`;
  expect((await request.post(`${api}/blocks`, { data: { label, start: '09:00', duration: 60, type: 'focus' } })).ok()).toBeTruthy();
  await page.goto('/planner');
  const action = page.getByRole('button', { name: 'Add block', exact: true });
  await expect(action).toBeEnabled();
  for (const mode of ['dark', 'light']) {
    let statusColours: string[] | undefined;
    for (const palette of ['rust', 'cobalt', 'sage']) {
      const statuses = await page.evaluate(({ mode, palette }) => {
        document.documentElement.dataset.mode = mode;
        document.documentElement.dataset.palette = palette;
        const style = getComputedStyle(document.documentElement);
        return ['--db-danger', '--db-warning', '--db-success', '--db-focus'].map((role) => style.getPropertyValue(role).trim());
      }, { mode, palette });
      if (statusColours) expect(statuses).toEqual(statusColours);
      statusColours = statuses;
      for (const state of ['rest', 'hover', 'pressed']) {
        if (state === 'rest') await page.mouse.move(0, 0);
        else await action.hover();
        if (state === 'pressed') await page.mouse.down();
        // Let the shared control's colour transition settle before measuring.
        await page.waitForTimeout(180);
        const samples = [action, page.getByTestId("planner-calendar").getByTestId("calendar-event").filter({ hasText: label }).locator(".planner-event__title")];
        const contrasts = await Promise.all(samples.map((sample) => sample.evaluate((element) => {
          const style = getComputedStyle(element);
          const luminance = (colour: string) => {
            const rgb = colour.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
              const channel = value / 255;
              return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
            });
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
          };
          const background = getComputedStyle(element.closest('[data-testid="calendar-event"]') ?? element).backgroundColor;
          const a = luminance(style.color), b = luminance(background);
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        })));
        if (state === 'pressed') {
          await page.mouse.move(0, 0);
          await page.mouse.up();
        }
        for (const contrast of contrasts) expect(contrast, `${mode}/${palette}/${state}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
  await page.evaluate(() => { delete document.documentElement.dataset.mode; delete document.documentElement.dataset.palette; });
  await page.keyboard.press('Tab');
  await action.focus();
  await expect(action).toHaveCSS('outline-style', 'solid');
  await expect(action).toHaveCSS('outline-width', '2px');
});

test('narrow history opens a modal and returns keyboard focus', async ({ page, request }) => {
  const firstIntent = `First intent ${Date.now()}`;
  for (const reason of [firstIntent, 'Updated intent']) {
    expect((await request.post(`${api}/plan/revise`, { data: { reason, copy_mode: 'all' } })).ok()).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/planner');
  const trigger = page.getByRole('button', { name: 'Show history' });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Plan revisions' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(firstIntent)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('failed revision saves retain the draft and reason for retry', async ({ page, request }) => {
  const label = `Recover draft ${Date.now()}`;
  const reason = 'Protect the writing session';
  await page.goto('/planner');
  const before = await (await request.get(`${api}/plan/today`)).json();
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByLabel('Label', { exact: true }).fill(label);
  await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  const event = page.getByTestId('planner-calendar').getByTestId('calendar-event').filter({ hasText: label });
  await expect(event).toHaveAttribute('data-unsaved', 'true');
  await page.getByPlaceholder('What prompted this revision?').fill(reason);
  await page.evaluate(() => { document.documentElement.dataset.mode = 'light'; document.documentElement.dataset.palette = 'cobalt'; });
  await expect(event).toHaveAttribute('data-unsaved', 'true');
  await expect(page.getByPlaceholder('What prompted this revision?')).toHaveValue(reason);
  await page.route('**/plan/replan*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) }));
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your draft is retained' })).toBeVisible();
  await expect(page.getByPlaceholder('What prompted this revision?')).toHaveValue(reason);
  await expect(event).toHaveAttribute('data-unsaved', 'true');
  const failed = await (await request.get(`${api}/plan/today`)).json();
  expect(failed.revisions).toEqual(before.revisions);
  await page.unroute('**/plan/replan*');
  await page.getByTestId('planner-commit-replan').click();
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
  await expect(event).toHaveAttribute('data-unsaved', 'false');
  const saved = await (await request.get(`${api}/plan/today`)).json();
  expect(saved.revisions).toHaveLength(before.revisions.length + 1);
  expect(saved.revisions.at(-1).reason).toBe(reason);
});
