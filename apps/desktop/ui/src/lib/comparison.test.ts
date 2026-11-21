import { describe, expect, it } from 'vitest';
import { describeBlockChanges } from './comparison';

describe('revision change descriptions', () => {
  it('explains moved and shortened blocks with before and after values', () => {
    expect(describeBlockChanges({ start: { before: '09:00', after: '10:30' }, duration: { before: 60, after: 45 }, focus_rating: { before: null, after: 4 } }))
      .toEqual(['Start time: 09:00 → 10:30', 'Duration: 1h → 45 min', 'Focus rating: not recorded → 4/5']);
  });
});
