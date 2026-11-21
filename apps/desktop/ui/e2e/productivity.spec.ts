import { expect, test } from "./fixtures";

test("backlog, notes, compare, and settings regular flows work", async ({
  page, request,
}) => {
  const suffix = Date.now().toString().slice(-6);
  const taskLabel = `Ship desktop ${suffix}`;
  const noteBody = `Note ${suffix}`;

  await page.goto("/backlog");
  await page.getByTestId("backlog-input").fill(taskLabel);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText(taskLabel)).toBeVisible();
  await page.getByRole("button", { name: "Start task" }).first().click();
  await expect(page.getByText(taskLabel)).toBeVisible();

  await page.goto("/notes");
  await page.getByTestId("notes-editor").fill(noteBody);
  const plan = await (await request.get('http://127.0.0.1:8010/plan/today')).json();
  await expect.poll(async () => (await (await request.get(`http://127.0.0.1:8010/notes/${plan.date}`)).json()).content).toBe(noteBody);
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page.getByTestId("notes-editor")).toHaveValue(noteBody);

  await page.goto("/settings");
  await page.getByLabel("Default duration").fill("75");
  await page.getByTestId("save-settings").click();
  await expect(page.getByLabel("Default duration")).toHaveValue("75");

  await page.goto("/compare");
  await expect(page.getByTestId("compare-summary")).toContainText("added");

  await page.getByRole("link", { name: "Help", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Getting started", exact: true })).toBeVisible();
  await expect(page.getByText("Choose today or a future date. Add blocks with a start time, duration and type. Calendar and list show the same plan.", { exact: true })).toBeVisible();
  // Keep the native smoke assertion's route-specific guidance exercised too.
  await expect(page.getByRole("heading", { name: "Keyboard navigation", exact: true })).toBeVisible();
});
