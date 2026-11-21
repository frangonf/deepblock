import { expect, test } from "./fixtures";
const api = "http://127.0.0.1:8010";
test("complete bundle export, cancellation, replacement and recovery restore work in Settings", async ({
  page,
  request,
}, testInfo) => {
  const oldGeneration = (
    await (await request.get(`${api}/storage/status`)).json()
  ).generation as string;
  expect(
    (
      await request.put(`${api}/notes/2026-01-11`, {
        data: { content: "# Portable 🦀\n\n[Vault](../vault.md)" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/settings");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export bundle", exact: true })
    .click();
  const download = await downloadEvent;
  const file = testInfo.outputPath("complete.zip");
  await download.saveAs(file);
  expect(
    (
      await request.put(`${api}/notes/2026-01-12`, {
        data: { content: "Created after export" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByLabel("Import file").setInputFiles(file);
  await expect(page.getByRole("dialog")).toContainText("1 removed");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await (await request.get(`${api}/notes/2026-01-12`)).json()).content,
  ).toBe("Created after export");
  await page.getByLabel("Import file").setInputFiles(file);
  await page
    .getByRole("checkbox", {
      name: "I understand this replaces my saved data and notes.",
    })
    .check();
  await page.getByRole("button", { name: "Replace data", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dataset replaced" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reload restored data" }).click();
  await expect(
    page.getByRole("button", { name: "Restore recovery", exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get(`${api}/notes/2026-01-12`)).json()).content,
  ).toBe("");
  expect(
    (
      await request.put(`${api}/notes/2026-01-12`, {
        headers: { "x-deepblock-dataset-generation": oldGeneration },
        data: { content: "Stale" },
      })
    ).status(),
  ).toBe(409);
  await page
    .getByRole("button", { name: "Restore recovery", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I understand this replaces my saved data and notes.",
    })
    .check();
  await page.getByRole("button", { name: "Replace data", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dataset replaced" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reload restored data" }).click();
  expect(
    (await (await request.get(`${api}/notes/2026-01-12`)).json()).content,
  ).toBe("Created after export");
});

test("context editing preserves identities and exposes historical labels", async ({
  page,
  request,
}) => {
  await page.goto("/settings");
  await page
    .getByLabel("Project name", { exact: true })
    .fill("M8 original project");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(
    page.getByText("M8 original project · personal", { exact: true }),
  ).toBeVisible();
  const catalog = await (await request.get(`${api}/context`)).json();
  const project = catalog.projects.find(
    (p: { name: string }) => p.name === "M8 original project",
  );
  expect(
    (
      await request.post(`${api}/blocks?date=2026-02-01`, {
        data: {
          label: "M8 task",
          start: "09:00",
          duration: 30,
          metadata: { project_id: project.id },
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Edit project M8 original project" })
    .click();
  await page.getByLabel("Edited context label").fill("M8 renamed project");
  await page.getByLabel("Edited project ownership").selectOption("employer");
  await page.getByRole("button", { name: "Save context edit" }).click();
  await expect(
    page.getByText("M8 renamed project · employer", { exact: true }),
  ).toBeVisible();
  const edited = await (await request.get(`${api}/context`)).json();
  expect(
    edited.projects.find((p: { id: string }) => p.id === project.id).name,
  ).toBe("M8 renamed project");
  await page.goto("/review?date=2026-02-01");
  await expect(
    page.getByRole("heading", { name: "Intent history", exact: true }),
  ).toBeVisible();
  const snapshots = page.getByTestId("intent-history").locator("details");
  await expect(snapshots).toHaveCount(2);
  for (const snapshot of await snapshots.all())
    await snapshot.locator("summary").click();
  await expect(
    page.getByText("M8 original project · personal · Unassigned goal"),
  ).toBeVisible();
  await expect(
    page.getByText("M8 renamed project · employer · Unassigned goal"),
  ).toBeVisible();
});
