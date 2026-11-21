import { describe, expect, it } from 'vitest';
import { validPlanDate } from './use-selected-date';
import { todayString } from '@/lib/utils';

describe('selected day', () => {
  it('keeps real dates and falls back for malformed or impossible URL dates', () => {
    expect(validPlanDate('2024-02-29')).toBe('2024-02-29');
    for (const value of [null, '', 'yesterday', '2026-02-30', '2026-13-01', '2026-2-01']) expect(validPlanDate(value)).toBe(todayString());
  });
});
