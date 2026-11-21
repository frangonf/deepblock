import { draftNamespace, setFormDirty } from '@/lib/dataset';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block, Revision } from '@/lib/api';
import {
  applyDraftCreate, applyDraftDelete, applyDraftUpdate, cloneBlocks, createDraftBlock,
  type DraftBlockInput, type DraftOperation,
} from '@/components/planner/calendarDraft';

const storageKey = () => `deepblock.planner-draft.v2:${draftNamespace()}`;
const completedEvent = 'deepblock:planner-draft-completed';
type PlannerDraft = { date: string; baseRevision: Revision; blocks: Block[]; operations: DraftOperation[]; reason?: string };
function loadDrafts(): Record<string, PlannerDraft> {
  try {
    const raw = sessionStorage.getItem(storageKey());
    if (!raw) return {};
    const drafts = JSON.parse(raw) as Record<string, PlannerDraft>;
    return Object.values(drafts).every((draft) => typeof draft?.date === 'string' && Array.isArray(draft.blocks)
      && Array.isArray(draft.operations) && Array.isArray(draft.baseRevision?.blocks)) ? drafts : {};
  } catch { return {}; }
}

function newDraft(date: string, revision: Revision): PlannerDraft {
  return { date, baseRevision: { ...revision, blocks: cloneBlocks(revision.blocks) }, blocks: cloneBlocks(revision.blocks), operations: [] };
}

export function usePlannerDraft(date: string, revision: Revision | null, committing: boolean) {
  const [drafts, setDrafts] = useState<Record<string, PlannerDraft>>(loadDrafts);
  const latestDrafts = useRef(drafts);
  // Validate before queueing a render so the UI can catch rejected gestures.
  // Also keep consecutive edits within one event in order.
  const updateDrafts = useCallback((update: (previous: Record<string, PlannerDraft>) => Record<string, PlannerDraft>) => {
    const next = update(latestDrafts.current);
    latestDrafts.current = next;
    setDrafts(next);
  }, []);
  const current = drafts[date] ?? null;
  const dirty = Boolean(current?.operations.length);
  const conflict = dirty && JSON.stringify(current?.baseRevision) !== JSON.stringify(revision);
  const blocks = useMemo(() => current?.blocks ?? cloneBlocks(revision?.blocks ?? []), [current, revision]);
  const changeCount = current ? new Set([...current.baseRevision.blocks, ...current.blocks].map((block) => block.id)).size
    - current.baseRevision.blocks.filter((block) => JSON.stringify(block) === JSON.stringify(current.blocks.find((candidate) => candidate.id === block.id))).length : 0;
  const hasUnsavedDrafts = Object.values(drafts).some((draft) => draft.operations.length > 0);

  useEffect(() => { setFormDirty('planner', hasUnsavedDrafts); return () => setFormDirty('planner', false); }, [hasUnsavedDrafts]);
  useEffect(() => {
    try {
      if (hasUnsavedDrafts) sessionStorage.setItem(storageKey(), JSON.stringify(drafts));
      else sessionStorage.removeItem(storageKey());
    } catch { /* Editing still works if the runtime denies session storage. */ }
  }, [drafts, hasUnsavedDrafts]);

  useEffect(() => {
    const completed = (event: Event) => {
      const completedDate = (event as CustomEvent<string>).detail;
      updateDrafts((previous) => {
        const remaining = { ...previous };
        delete remaining[completedDate];
        return remaining;
      });
    };
    window.addEventListener(completedEvent, completed);
    return () => window.removeEventListener(completedEvent, completed);
  }, [updateDrafts]);

  useEffect(() => {
    if (!hasUnsavedDrafts) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedDrafts]);

  const change = useCallback((update: (draft: PlannerDraft) => PlannerDraft) => {
    if (!revision || committing) return;
    updateDrafts((previous) => {
      const next = update(previous[date] ?? newDraft(date, revision));
      if (JSON.stringify(next.blocks) === JSON.stringify(next.baseRevision.blocks)) {
        const remaining = { ...previous };
        delete remaining[date];
        return remaining;
      }
      return { ...previous, [date]: next };
    });
  }, [committing, date, revision, updateDrafts]);

  const create = useCallback((input: DraftBlockInput) => {
    const block = createDraftBlock(input);
    change((draft) => ({ ...draft, blocks: applyDraftCreate(draft.blocks, block), operations: [...draft.operations, { type: 'create', block }] }));
    return block;
  }, [change]);

  const updateMany = useCallback((updates: Array<{ blockId: string; payload: Record<string, unknown> }>) => {
    change((draft) => {
      for (const { blockId, payload } of updates) {
        const before = draft.blocks.find((block) => block.id === blockId);
        if (!before) continue;
        // Rebase only intentional form changes, not unrelated remote feedback.
        const changes = Object.fromEntries(Object.entries(payload).filter(([key, value]) =>
          JSON.stringify(key === 'project_id' || key === 'goal_id' ? before.metadata[key] ?? null : before[key as keyof Block]) !== JSON.stringify(value)));
        if (Object.keys(changes).length === 0) continue;
        draft = { ...draft, blocks: applyDraftUpdate(draft.blocks, blockId, changes), operations: [...draft.operations, { type: 'update', blockId, payload: changes }] };
      }
      return draft;
    });
  }, [change]);
  const update = useCallback((blockId: string, payload: Record<string, unknown>) => updateMany([{ blockId, payload }]), [updateMany]);

  const remove = useCallback((blockId: string) => {
    change((draft) => ({ ...draft, blocks: applyDraftDelete(draft.blocks, blockId), operations: [...draft.operations, { type: 'delete', blockId }] }));
  }, [change]);

  const rebase = useCallback(() => {
    if (!revision || !current || committing) return;
    let blocks = cloneBlocks(revision.blocks);
    for (const operation of current.operations) {
      if (operation.type === 'create') blocks = applyDraftCreate(blocks, operation.block);
      else {
        if (!blocks.some((block) => block.id === operation.blockId)) throw new Error('A draft block was deleted remotely. Your draft is retained; discard or adjust it before retrying.');
        blocks = operation.type === 'update' ? applyDraftUpdate(blocks, operation.blockId, operation.payload) : applyDraftDelete(blocks, operation.blockId);
      }
    }
    updateDrafts((previous) => ({ ...previous, [date]: { ...current, baseRevision: { ...revision, blocks: cloneBlocks(revision.blocks) }, blocks } }));
  }, [committing, current, date, revision, updateDrafts]);

  const setReason = useCallback((reason: string) => {
    if (committing) return;
    updateDrafts((previous) => previous[date] ? { ...previous, [date]: { ...previous[date], reason } } : previous);
  }, [committing, date, updateDrafts]);

  const complete = useCallback(() => {
    // Mutation callbacks can finish after this hook unmounts. Clear the
    // persisted day immediately, and notify any newly mounted planner.
    try {
      const remaining = loadDrafts();
      delete remaining[date];
      if (Object.keys(remaining).length) sessionStorage.setItem(storageKey(), JSON.stringify(remaining));
      else sessionStorage.removeItem(storageKey());
    } catch { /* In-memory completion remains available without storage. */ }
    window.dispatchEvent(new CustomEvent(completedEvent, { detail: date }));
  }, [date]);
  const discard = useCallback(() => { if (!committing) complete(); }, [committing, complete]);
  return { blocks, changeCount, reason: current?.reason ?? '', setReason, operations: current?.operations ?? [], baseRevision: current?.baseRevision ?? null, dirty, conflict, create, update, updateMany, remove, rebase, discard, complete };
}
