import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Block, Revision } from '@/lib/api';
import { usePlannerDraft } from './use-planner-draft';

const block: Block = {
  id: 'work', label: 'Work', start: '09:00', duration: 30, type: 'focus', status: 'proposed',
  created_at: '2026-10-01T00:00:00', metadata: {}, content_path: null, focus_rating: 1,
  actual_duration: null, next_action: 'Original', artifacts: [], reality: null,
};
const revision: Revision = { id: 'A', created_at: '2026-10-01T00:00:00', reason: 'Initial', blocks: [block] };
const date = '2026-10-01';

describe('planner draft safety', () => {
  beforeEach(() => sessionStorage.clear());

  it('counts affected blocks and clears drafts that return to the saved plan', () => {
    const { result } = renderHook(() => usePlannerDraft(date, revision, false));
    act(() => result.current.update('work', { label: 'Changed' }));
    act(() => result.current.update('work', { label: 'Changed again' }));
    expect(result.current.changeCount).toBe(1);
    act(() => result.current.update('work', { label: 'Work' }));
    expect(result.current.dirty).toBe(false);
    expect(result.current.changeCount).toBe(0);
    let created!: Block;
    act(() => { created = result.current.create({ label: 'Temporary', start: '10:00', duration: 30, type: 'focus' }); });
    act(() => result.current.remove(created.id));
    expect(result.current.dirty).toBe(false);
  });

  it('rejects overflow synchronously so the UI can report it without losing the draft', () => {
    const { result } = renderHook(() => usePlannerDraft(date, revision, false));
    let rejected: unknown;
    act(() => {
      try { result.current.update('work', { start: '23:50' }); }
      catch (error) { rejected = error; }
    });
    expect(rejected).toBeInstanceOf(Error);
    expect(result.current.blocks).toEqual(revision.blocks);
    expect(result.current.dirty).toBe(false);
  });

  it('keeps consecutive changes in one event, including ripple updates', () => {
    const { result } = renderHook(() => usePlannerDraft(date, revision, false));
    act(() => {
      result.current.update('work', { label: 'Renamed' });
      result.current.update('work', { start: '10:00' });
    });
    expect(result.current.blocks[0]).toMatchObject({ label: 'Renamed', start: '10:00' });
    expect(result.current.operations).toHaveLength(2);
  });

  it('undoes a whole scheduling gesture after reload without discarding earlier edits', () => {
    const neighbor = { ...block, id: 'meeting', label: 'Meeting', start: '09:30' };
    const day = { ...revision, blocks: [block, neighbor] };
    const first = renderHook(() => usePlannerDraft(date, day, false));
    act(() => first.result.current.update('work', { label: 'Renamed' }));
    act(() => first.result.current.updateMany([
      { blockId: 'work', payload: { duration: 45 } },
      { blockId: 'meeting', payload: { label: 'Moved meeting' } },
    ]));
    expect(first.result.current.blocks[1]).toMatchObject({ label: 'Moved meeting', start: '09:45' });
    first.unmount();

    const recovered = renderHook(() => usePlannerDraft(date, day, false));
    act(() => recovered.result.current.undo());
    expect(recovered.result.current.blocks).toEqual([{ ...block, label: 'Renamed' }, neighbor]);
    expect(recovered.result.current.operations).toEqual([{ type: 'update', blockId: 'work', payload: { label: 'Renamed' } }]);
  });

  it('rejects a compound move atomically before changing the retained draft', () => {
    const { result } = renderHook(() => usePlannerDraft(date, revision, false));
    expect(() => result.current.updateMany([
      { blockId: 'work', payload: { label: 'Changed' } },
      { blockId: 'work', payload: { start: '23:50' } },
    ])).toThrow('24:00');
    expect(result.current.blocks).toEqual(revision.blocks);
    expect(result.current.operations).toHaveLength(0);
  });

  it('retains staged blocks on refresh and detects metadata-only conflicts', () => {
    const { result, rerender } = renderHook(({ revision }) => usePlannerDraft(date, revision, false), { initialProps: { revision } });
    act(() => result.current.update('work', { label: 'Local', focus_rating: 1, next_action: 'Original' }));
    const remote = { ...revision, blocks: [{ ...block, focus_rating: 5, next_action: 'Remote' }] };
    rerender({ revision: remote });
    expect(result.current.dirty).toBe(true);
    expect(result.current.conflict).toBe(true);
    expect(result.current.blocks[0].label).toBe('Local');
    act(() => result.current.rebase());
    expect(result.current.conflict).toBe(false);
    expect(result.current.blocks[0]).toMatchObject({ label: 'Local', focus_rating: 5, next_action: 'Remote' });
    expect(result.current.operations).toEqual([{ type: 'update', blockId: 'work', payload: { label: 'Local' } }]);
  });

  it('does not stage or discard accepted changes while committing', () => {
    const { result, rerender } = renderHook(({ committing }) => usePlannerDraft(date, revision, committing), { initialProps: { committing: false } });
    act(() => result.current.update('work', { label: 'Submitted' }));
    rerender({ committing: true });
    act(() => {
      result.current.update('work', { label: 'Too late' });
      result.current.remove('work');
      result.current.discard();
    });
    expect(result.current.blocks[0].label).toBe('Submitted');
    expect(result.current.operations).toHaveLength(1);
  });

  it('restores drafts after navigation or reload', () => {
    const first = renderHook(() => usePlannerDraft(date, revision, false));
    act(() => first.result.current.update('work', { label: 'Retained' }));
    first.unmount();
    const next = renderHook(() => usePlannerDraft(date, revision, false));
    expect(next.result.current.dirty).toBe(true);
    expect(next.result.current.blocks[0].label).toBe('Retained');
    act(() => next.result.current.complete());
    next.unmount();
    const completed = renderHook(() => usePlannerDraft(date, revision, false));
    expect(completed.result.current.dirty).toBe(false);
  });

  it('clears a completed draft even when the original planner unmounted mid-commit', () => {
    const first = renderHook(() => usePlannerDraft(date, revision, false));
    act(() => first.result.current.update('work', { label: 'Submitted' }));
    const complete = first.result.current.complete;
    first.unmount();
    const next = renderHook(() => usePlannerDraft(date, revision, false));
    expect(next.result.current.dirty).toBe(true);
    act(complete);
    expect(next.result.current.dirty).toBe(false);
  });

  it('preserves separate drafts when changing dates', () => {
    const { result, rerender } = renderHook(({ date }) => usePlannerDraft(date, revision, false), { initialProps: { date } });
    act(() => result.current.update('work', { label: 'First day' }));
    rerender({ date: '2026-10-02' });
    expect(result.current.dirty).toBe(false);
    act(() => result.current.update('work', { label: 'Second day' }));
    rerender({ date });
    expect(result.current.blocks[0].label).toBe('First day');
  });

  it('keeps optional revision reasons with the date-scoped retained draft', () => {
    const first = renderHook(({ date }) => usePlannerDraft(date, revision, false), { initialProps: { date } });
    act(() => first.result.current.update('work', { label: 'Changed' }));
    act(() => first.result.current.setReason('Unexpected meeting'));
    first.rerender({ date: '2026-10-02' });
    expect(first.result.current.reason).toBe('');
    first.rerender({ date });
    expect(first.result.current.reason).toBe('Unexpected meeting');
    first.unmount();
    const recovered = renderHook(() => usePlannerDraft(date, revision, false));
    expect(recovered.result.current.reason).toBe('Unexpected meeting');
    act(() => recovered.result.current.discard());
    expect(recovered.result.current.reason).toBe('');
  });

  it('retains the draft when a remote deletion prevents rebase', () => {
    const { result, rerender } = renderHook(({ revision }) => usePlannerDraft(date, revision, false), { initialProps: { revision } });
    act(() => result.current.update('work', { label: 'Retained' }));
    rerender({ revision: { ...revision, blocks: [] } });
    expect(() => act(() => result.current.rebase())).toThrow('deleted remotely');
    expect(result.current.blocks[0].label).toBe('Retained');
    expect(result.current.conflict).toBe(true);
  });
});
