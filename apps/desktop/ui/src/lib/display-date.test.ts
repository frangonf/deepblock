import { expect, it } from 'vitest';
import { formatPlanDate } from './utils';
it('uses an unambiguous local calendar date without shifting the day', () => {
  expect(formatPlanDate('2026-10-01')).toMatch(/1.*October.*2026/);
  expect(formatPlanDate('2024-02-29')).toMatch(/29.*February.*2024/);
});
