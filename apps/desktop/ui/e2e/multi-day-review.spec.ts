import { expect, test } from './fixtures';

test('multi-day review distinguishes reported zero from absent feedback', async ({ page, request }) => {
  const api = 'http://127.0.0.1:8010';
  const first = await request.post(`${api}/blocks?date=2025-04-01`, { data: { label: 'Reported zero', start: '09:00', duration: 60 } });
  expect(first.ok()).toBeTruthy();
  const plan = await first.json();
  const id = plan.revisions.at(-1).blocks[0].id;
  expect((await request.patch(`${api}/blocks/${id}/outcome?date=2025-04-01`, { data: { actual_duration: 0 } })).ok()).toBeTruthy();
  expect((await request.post(`${api}/blocks?date=2025-04-02`, { data: { label: 'No feedback', start: '09:00', duration: 30 } })).ok()).toBeTruthy();
  await page.goto('/review?date=2025-04-02');
  await page.getByLabel('Review start', { exact: true }).fill('2025-04-01');
  await page.getByLabel('Review end', { exact: true }).fill('2025-04-03');
  await page.getByRole('button', { name: 'Review range', exact: true }).click();
  await expect(page.getByTestId('range-review-totals')).toContainText('90 minutes planned · 0 minutes reported');
  await expect(page.getByTestId('range-review-totals')).toContainText('1 of 2 blocks have reported minutes');
  await expect(page.getByText(/Revision A · 30 planned · No reported minutes/)).toBeVisible();
  await expect(page.getByText(/No saved plan · 0 planned · No reported minutes/)).toBeVisible();
});
