import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Block, ClientConfig, Revision } from '@/lib/api';
import { PlannerDraftControls } from './PlannerDraftControls';
import { PlannerCalendarView, plannerBlockAnchor, revisionTimeWindow } from './PlannerCalendarView';

const setEvents = vi.fn();

vi.mock('@schedule-x/calendar', () => ({
  createViewDay: () => ({ name: 'day' }),
}));

vi.mock('@schedule-x/current-time', () => ({
  createCurrentTimePlugin: () => ({ name: 'current-time' }),
}));

vi.mock('@schedule-x/events-service', () => ({
  createEventsServicePlugin: () => ({ set: setEvents }),
}));

vi.mock('@schedule-x/react', () => ({
  ScheduleXCalendar: () => <div data-testid="schedule-x-calendar" />,
  useCalendarApp: () => ({ name: 'calendar-app' }),
}));

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'block-1',
    label: 'Deep work',
    start: '09:00',
    duration: 60,
    type: 'focus',
    status: 'proposed',
    created_at: '2026-04-20T09:00:00Z',
    metadata: {},
    content_path: null,
    focus_rating: null,
    actual_duration: null,
    next_action: null,
    artifacts: [],
    reality: null,
    ...overrides,
  };
}

function makeRevision(id: string, blocks: Block[]): Revision {
  return {
    id,
    created_at: `2026-04-20T0${id}:00:00Z`,
    reason: id === 'A' ? 'Initial plan' : `Revision ${id}`,
    blocks,
  };
}

function renderPlannerCalendarView({
  historyRevisions = [makeRevision('A', [makeBlock()])],
  currentRevision = makeRevision('B', [makeBlock({ id: 'block-2', label: 'Review draft' })]),
  isDraftDirty = true,
  isCommittingDraft = false,
  config = undefined,
}: {
  historyRevisions?: Revision[];
  currentRevision?: Revision | null;
  isDraftDirty?: boolean;
  isCommittingDraft?: boolean;
  config?: ClientConfig;
} = {}) {
  const onDraftCreate = vi.fn(() => makeBlock({ id: 'draft-1' }));
  const onDraftUpdate = vi.fn();
  const onDraftDelete = vi.fn();
  const onCommitDraft = vi.fn(async () => {});
  const onDiscardDraft = vi.fn();

  render(
    <>
    <PlannerDraftControls dirty={isDraftDirty} saving={isCommittingDraft} conflict={false} changeCount={1} reason="" onReasonChange={vi.fn()} onSave={onCommitDraft} onDiscard={onDiscardDraft} onRebase={() => {}} />
    <PlannerCalendarView
      historyRevisions={historyRevisions}
      selectedDate="2026-04-20"
      currentRevision={currentRevision}
      canEdit
      config={config}
      isCommittingDraft={isCommittingDraft}
      onDraftCreate={onDraftCreate}
      onDraftUpdate={onDraftUpdate}
      onDraftDelete={onDraftDelete}
    />
    </>,
  );

  return {
    onDraftCreate,
    onDraftUpdate,
    onDraftDelete,
    onCommitDraft,
    onDiscardDraft,
  };
}

describe('PlannerCalendarView', () => {
  describe('plannerBlockAnchor', () => {
    it('positions the inline editor to the left of the block when history is visible', () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });

      const position = plannerBlockAnchor({ left: 400, top: 200, width: 100, height: 100 }, true, { width: 352, height: 560 });

      expect(position).toEqual({ left: 32, top: 200 });
    });

    it('clamps the inline editor inside the right viewport edge when history is hidden', () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });

      const position = plannerBlockAnchor({ left: 1000, top: 200, width: 100, height: 100 }, false, { width: 352, height: 560 });

      expect(position).toEqual({ left: 912, top: 200 });
    });

    it.each([false, true])('clamps using the measured panel dimensions (history: %s)', (showHistory) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });

      const position = plannerBlockAnchor({ left: 1600, top: 650, width: 100, height: 100 }, showHistory, { width: 588, height: 432 });

      expect(position).toEqual({ left: 420, top: 272 });
    });
  });

  describe('revisionTimeWindow', () => {
    it('uses full-day boundaries for revision columns by default', () => {
      const result = revisionTimeWindow({});

      expect(result).toEqual({
        startBoundary: 0,
        endBoundary: 1440,
        gridHeight: 1440,
      });
    });

    it('scales the grid without changing the time boundaries', () => {
      const result = revisionTimeWindow({ gridScale: 1.25 });

      expect(result).toEqual({
        startBoundary: 0,
        endBoundary: 1440,
        gridHeight: 1800,
      });
    });
  });

  describe('draft controls', () => {
    it('toggles history visibility and triggers draft actions', () => {
      const { onCommitDraft, onDiscardDraft } = renderPlannerCalendarView();

      fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
      expect(screen.getByRole('region', { name: 'Plan revisions' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Hide history' }));
      expect(screen.queryByRole('region', { name: 'Plan revisions' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
      expect(screen.getByRole('region', { name: 'Plan revisions' })).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('planner-discard-draft'));
      fireEvent.click(screen.getByTestId('planner-commit-replan'));

      expect(onDiscardDraft).toHaveBeenCalledTimes(1);
      expect(onCommitDraft).toHaveBeenCalledTimes(1);
    });

    it('shows the saved state and disables draft actions when nothing is staged', () => {
      renderPlannerCalendarView({ isDraftDirty: false });

      expect(screen.getByText('All changes saved')).toBeInTheDocument();
      expect(screen.getByTestId('planner-discard-draft')).toBeDisabled();
      expect(screen.getByTestId('planner-commit-replan')).toBeDisabled();
    });
  });
});
