import { afterEach, expect, it, vi } from 'vitest';
import { applyDraftUpdate, cloneBlock, createDraftBlock, DRAFT_BLOCK_PREFIX, normalizeDraftBlocks } from './calendarDraft';

afterEach(() => vi.unstubAllGlobals());

const block = (label: string, start: string, duration = 30) => ({ ...createDraftBlock({ label, start, duration, type: 'focus' }), id: label });

it('clones nested JSON metadata without changing the saved block', () => {
  const saved = { ...block('Work', '09:00'), metadata: { links: ['original'] } };
  const draft = cloneBlock(saved);
  expect(draft).toEqual(saved);
  (draft.metadata.links as string[]).push('draft');
  expect(saved.metadata.links).toEqual(['original']);
});

it('orders equal starts by label exactly as the server does, not creation time', () => {
  const first = { ...block('Zebra', '09:00'), created_at: '2026-01-01T00:00:00' };
  const second = { ...block('Alpha', '09:00'), created_at: '2026-01-02T00:00:00' };
  expect(normalizeDraftBlocks([first, second]).map((item) => item.label)).toEqual(['Alpha', 'Zebra']);
  expect(normalizeDraftBlocks([block('😀', '09:00'), block('\uffff', '09:00')]).map((item) => item.label)).toEqual(['\uffff', '😀']);
});

it('ripples every simultaneous overlap, not only the first one', () => {
  const updated = applyDraftUpdate([block('Zebra', '09:00'), block('Alpha', '09:00'), block('Moved', '08:00', 60)], 'Moved', { start: '09:00' });
  expect(updated.find((item) => item.id === 'Alpha')?.start).toBe('10:00');
  expect(updated.find((item) => item.id === 'Zebra')?.start).toBe('10:30');
});

it('does not ripple cancelled blocks or ripple from a cancelled target', () => {
  const cancelled = { ...block('Cancelled', '23:00', 60), status: 'cancelled' as const };
  expect(applyDraftUpdate([block('Moved', '20:00'), cancelled], 'Moved', { start: '23:00' }).find((item) => item.id === 'Cancelled')?.start).toBe('23:00');
  expect(applyDraftUpdate([block('Work', '23:00'), { ...cancelled, start: '20:00' }], 'Cancelled', { start: '23:00' }).find((item) => item.id === 'Work')?.start).toBe('23:00');
});

it('rejects midnight overflow without mutating the retained draft', () => {
  const blocks = [block('Late', '23:00', 60), block('Moved', '20:00', 30)];
  const before = structuredClone(blocks);
  expect(() => applyDraftUpdate(blocks, 'Moved', { start: '23:00' })).toThrow('24:00');
  expect(blocks).toEqual(before);
});

it.each(['9:00', '08:60', '24:00'])('rejects the same invalid canonical start as the server: %s', (start) => {
  expect(() => applyDraftUpdate([block('Work', '09:00')], 'Work', { start })).toThrow();
});

it('permits a cascade ending exactly at midnight', () => {
  expect(applyDraftUpdate([block('Early', '22:00', 30), block('Moved', '20:00', 90)], 'Moved', { start: '22:00' })
    .find((item) => item.id === 'Early')?.start).toBe('23:30');
});

it('creates unique draft identifiers when HTTP origins only expose getRandomValues', () => {
  // Keep the real CSPRNG, but reproduce HTTP LAN origins' missing randomUUID.
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const input = { label: 'LAN block', start: '09:00', duration: 60, type: 'focus' as const };
  const first = createDraftBlock(input);
  const second = createDraftBlock(input);
  expect(first.id.startsWith(DRAFT_BLOCK_PREFIX)).toBe(true);
  expect(first.id.length).toBeGreaterThanOrEqual(DRAFT_BLOCK_PREFIX.length + 32);
  expect(second.id).not.toBe(first.id);
  expect(first).toMatchObject(input);
});
