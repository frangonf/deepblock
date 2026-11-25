import { useThemeMode } from "@/hooks/use-theme-mode";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  createViewDay,
  type CalendarConfig,
  type CalendarEvent,
} from "@schedule-x/calendar";
import { createCurrentTimePlugin } from "@schedule-x/current-time";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react";
import { Eye, EyeOff } from "lucide-react";
import { Temporal } from "temporal-polyfill";

import type {
  Block,
  ClientConfig,
  Revision,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BlockFields, useBlockForm } from "./BlockFields";
import {
  typeOptions,
  labelTone,
} from "@/components/planner/shared";
import {
  cn,
  formatMinutes,
  formatTime,
  parseTime,
  todayString,
} from "@/lib/utils";
import { applyDraftUpdate, type DraftBlockInput } from "@/components/planner/calendarDraft";

const dayView = createViewDay();
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const sharedCalendars = Object.fromEntries(
  typeOptions.map((type) => [
    type,
    {
      colorName: type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
      lightColors: {
        main: `var(--db-${type}-block)`,
        container: "var(--db-surface)",
        onContainer: "var(--db-ink)",
      },
      darkColors: {
        main: `var(--db-${type}-block)`,
        container: "var(--db-raised)",
        onContainer: "var(--db-ink)",
      },
    },
  ]),
);

type PlannerCalendarEvent = CalendarEvent & {
  block: Block;
  revisionId: string;
  isEditable: boolean;
  isUnsaved: boolean;
  timeFormat: ClientConfig["time_format"];
};

type InlineEditorAnchor = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type InlineEditorState = {
  blockId: string;
  isNew: boolean;
  anchor: InlineEditorAnchor;
};

type DragSelectionState = {
  dayRect: DOMRect;
  surfaceRect: DOMRect;
  startMinutes: number;
  endMinutes: number;
};

type BlockDrag = {
  pointerId: number;
  block: Block;
  resize: boolean;
  originY: number;
  originScroll: number;
  clientY: number;
  active: boolean;
  offset?: number;
  preview?: { blocks: Block[]; error?: string };
};

type BlockTiming = { start: string; duration: number };

function clampDuration(value: number, config?: ClientConfig) {
  const interval = Math.max(1, config?.rounding_interval ?? 15);
  const minDuration = config?.min_duration ?? 15;
  const maxDuration = config?.max_duration ?? 480;
  const rounded = Math.max(interval, Math.round(value / interval) * interval);
  return Math.min(maxDuration, Math.max(minDuration, rounded));
}

function scheduleGridStep(roundingInterval?: number): 180 | 120 | 60 | 30 | 15 {
  const interval = roundingInterval ?? 15;

  if (interval >= 180) return 180;
  if (interval >= 120) return 120;
  if (interval >= 60) return 60;
  if (interval >= 30) return 30;
  return 15;
}

function formatDayBoundary(totalMinutes: number) {
  if (totalMinutes === 24 * 60) {
    return "24:00";
  }

  return formatTime(totalMinutes);
}

function floorToHour(totalMinutes: number) {
  return Math.floor(totalMinutes / 60) * 60;
}

function ceilToHour(totalMinutes: number) {
  return Math.ceil(totalMinutes / 60) * 60;
}

function zonedDateTimeAt(date: string, time: string) {
  return Temporal.PlainDate.from(date).toZonedDateTime({
    timeZone: localTimezone,
    plainTime: Temporal.PlainTime.from(time),
  });
}

function formatClockLabel(
  value: string,
  timeFormat: ClientConfig["time_format"],
) {
  const parsed = new Date(`2000-01-01T${value}:00`);
  return timeFormat === "12h"
    ? parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : value;
}

function buildScheduleEvent({
  block,
  revision,
  selectedDate,
  editable,
  isUnsaved,
  timeFormat,
}: {
  block: Block;
  revision: Revision;
  selectedDate: string;
  editable: boolean;
  isUnsaved: boolean;
  timeFormat: ClientConfig["time_format"];
}): PlannerCalendarEvent {
  const start = zonedDateTimeAt(selectedDate, block.start);

  return {
    id: block.id,
    title: block.label,
    start,
    end: start.add({ minutes: block.duration }),
    calendarId: block.type,
    resourceId: revision.id,
    block,
    revisionId: revision.id,
    isEditable: editable,
    isUnsaved,
    timeFormat,
    _options: {
      disableDND: !editable,
      disableResize: !editable,
      additionalClasses: [
        "planner-calendar__event-shell",
        editable
          ? "planner-calendar__event-shell--editable"
          : "planner-calendar__event-shell--readonly",
        block.status === "done" ? "planner-calendar__event-shell--done" : "",
        block.status === "cancelled"
          ? "planner-calendar__event-shell--cancelled"
          : "",
      ].filter(Boolean),
    },
  };
}

function EmptyHeader() {
  return null;
}

function PlannerTimeGridEvent({
  calendarEvent,
}: {
  calendarEvent: PlannerCalendarEvent;
}) {
  const block = calendarEvent.block;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const start = formatClockLabel(block.start, calendarEvent.timeFormat);
  const finish = formatClockLabel(
    formatTime(parseTime(block.start) + block.duration),
    calendarEvent.timeFormat,
  );
  const accessibleSummary = `${block.label}, ${start} to ${finish}, ${formatMinutes(block.duration)}, ${block.type}, ${block.status}${calendarEvent.isUnsaved ? ", unsaved" : ""}`;

  useEffect(() => {
    const event = cardRef.current?.closest<HTMLElement>(".sx__time-grid-event");
    if (!event) return;
    event.setAttribute("aria-label", accessibleSummary);
    event.setAttribute("title", accessibleSummary);
  }, [accessibleSummary]);

  return (
    <div
      ref={cardRef}
      data-testid="calendar-event"
      data-block-id={block.id}
      data-block-type={block.type}
      data-unsaved={calendarEvent.isUnsaved}
      title={`${block.label} · ${start} – ${finish} · ${formatMinutes(block.duration)} · ${block.type} · ${block.status}`}
      role="group"
      aria-label={accessibleSummary}
      className={cn(
        "planner-calendar__event-card",
        !calendarEvent.isEditable && "planner-calendar__event-card--readonly",
      )}
    >
      <div className="planner-event__content">
        <div className="planner-event__heading">
          <span className="planner-event__title">{block.label}</span>
          <span className="planner-event__short-time">{start}</span>
        </div>
        <div className="planner-event__time">
          {start} – {finish} · {formatMinutes(block.duration)}
        </div>
        <div className="planner-event__metadata">
          <span>{block.type}</span>
          <span>{calendarEvent.isUnsaved ? "Unsaved" : block.status}</span>
        </div>
        {block.next_action ? (
          <div className="planner-event__next">Next: {block.next_action}</div>
        ) : null}
      </div>
      {calendarEvent.isEditable && <span className="sx__time-grid-event-resize-handle" aria-hidden="true" />}
    </div>
  );
}

function RevisionHeader({
  revision,
  isActive,
}: {
  revision: Revision;
  isActive: boolean;
}) {
  return (
    <div
      data-testid="calendar-resource-header"
      data-resource-id={revision.id}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-[var(--db-radius)] border px-4 py-3",
        isActive
          ? "flex-row items-center justify-between border-line bg-raised"
          : "border-line bg-surface",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-ink">
          Revision {revision.id}
        </span>
        <Badge className={isActive ? "status-info" : undefined}>
          {isActive ? "Current plan" : "history"}
        </Badge>
      </div>
      <span className="truncate text-xs text-muted">
        {revision.reason ?? "No reason recorded"}
      </span>
    </div>
  );
}

export function plannerBlockAnchor(
  anchor: InlineEditorAnchor,
  showHistory: boolean,
  panel: { width: number; height: number },
) {
  const viewportWidth =
    typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 900 : window.innerHeight;
  const leftPosition = showHistory
    ? anchor.left - panel.width - 16
    : anchor.left + 24;

  return {
    left: Math.max(16, Math.min(leftPosition, viewportWidth - panel.width - 16)),
    top: Math.max(16, Math.min(anchor.top, viewportHeight - panel.height - 16)),
  };
}

function PlannerInlineEditor({
  block,
  anchor,
  isNew,
  showHistory,
  onSave,
  onDelete,
  onCancel,
}: {
  block: Block;
  anchor: InlineEditorAnchor;
  isNew: boolean;
  showHistory: boolean;
  onSave: (payload: ReturnType<typeof useBlockForm>['payload']) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const form = useBlockForm(block);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 16, top: 16 });

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const update = () => setPosition(plannerBlockAnchor(anchor, showHistory, editor.getBoundingClientRect()));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(editor);
    return () => observer.disconnect();
  }, [anchor, showHistory]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    editorRef.current
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
    const handlePointerDown = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        editorRef.current?.contains(event.target)
      )
        return;
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", onCancel);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", onCancel);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [onCancel]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-label={isNew ? "Draft block" : "Edit block"}
      ref={editorRef}
      data-testid="planner-inline-editor"
      className="planner-calendar__inline-editor fixed z-40 rounded-[var(--db-radius)] border border-line bg-surface p-4 shadow-2xl shadow-black/40"
      style={position}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">
            {isNew ? "Draft block" : "Edit block"}
          </div>
          <div className="text-xs text-muted">
            Apply changes to your draft, then save the revised plan.
          </div>
        </div>
        <Badge className={cn("text-xs", labelTone(block.type))}>
          {block.type}
        </Badge>
      </div>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form.payload);
        }}
      >
        <BlockFields form={form} compact />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <Button variant="ghost" type="button" size="sm" onClick={onDelete}>
            {isNew ? "Discard block" : "Delete block"}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" type="button" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Apply to draft
            </Button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function pointerToMinutes({
  clientY,
  dayRect,
  startBoundary,
  endBoundary,
  slotStep,
}: {
  clientY: number;
  dayRect: DOMRect;
  startBoundary: number;
  endBoundary: number;
  slotStep: number;
}) {
  const relativeY = Math.max(
    0,
    Math.min(dayRect.height, clientY - dayRect.top),
  );
  const ratio = dayRect.height === 0 ? 0 : relativeY / dayRect.height;
  const rawMinutes = startBoundary + ratio * (endBoundary - startBoundary);
  const snapped = Math.round(rawMinutes / slotStep) * slotStep;
  return Math.max(startBoundary, Math.min(endBoundary - slotStep, snapped));
}

function selectionAnchor({
  dayRect,
  startMinutes,
  endMinutes,
  startBoundary,
  endBoundary,
}: {
  dayRect: DOMRect;
  startMinutes: number;
  endMinutes: number;
  startBoundary: number;
  endBoundary: number;
}): InlineEditorAnchor {
  const topMinutes = Math.min(startMinutes, endMinutes);
  const bottomMinutes = Math.max(startMinutes, endMinutes);
  const totalMinutes = endBoundary - startBoundary;
  const topOffset =
    totalMinutes === 0
      ? 0
      : ((topMinutes - startBoundary) / totalMinutes) * dayRect.height;
  const height =
    totalMinutes === 0
      ? 0
      : ((bottomMinutes - topMinutes) / totalMinutes) * dayRect.height;

  return {
    top: dayRect.top + topOffset,
    left: dayRect.left,
    width: dayRect.width,
    height,
  };
}

function elementAnchor(element: HTMLElement): InlineEditorAnchor {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function findBlockElement(surface: HTMLElement | null, blockId: string) {
  if (!surface) {
    return null;
  }

  return (
    Array.from(surface.querySelectorAll<HTMLElement>("[data-block-id]")).find(
      (element) => element.getAttribute("data-block-id") === blockId,
    ) ?? null
  );
}

export function revisionTimeWindow({
  revision,
  config,
  slotStep,
  compact,
}: {
  revision: Revision;
  config?: ClientConfig;
  slotStep: number;
  compact: boolean;
}) {
  const defaultStartBoundary = (config?.start_hour ?? 0) * 60;
  const defaultEndBoundary = (config?.end_hour ?? 24) * 60;
  const defaultGridHeight = Math.max(
    900,
    ((config?.end_hour ?? 24) - (config?.start_hour ?? 0)) *
      60 *
      Math.max(1, config?.pixels_per_minute ?? 1),
  );

  if (!compact || revision.blocks.length === 0) {
    return {
      startBoundary: defaultStartBoundary,
      endBoundary: defaultEndBoundary,
      gridHeight: defaultGridHeight,
      eventWidth: 96,
    };
  }

  const previewPadding = Math.max(30, slotStep * 2);
  const earliestStart = Math.min(
    ...revision.blocks.map((block) => parseTime(block.start)),
  );
  const latestEnd = Math.max(
    ...revision.blocks.map((block) => parseTime(block.start) + block.duration),
  );
  const compactStart = Math.max(
    defaultStartBoundary,
    floorToHour(earliestStart - previewPadding),
  );
  const compactEnd = Math.min(
    defaultEndBoundary,
    ceilToHour(latestEnd + previewPadding),
  );
  const spanMinutes = Math.max(120, compactEnd - compactStart);

  return {
    startBoundary: compactStart,
    endBoundary: compactEnd,
    gridHeight: Math.max(260, Math.min(420, Math.round(spanMinutes * 0.7))),
    eventWidth: 88,
  };
}

const scheduleXCustomComponents = {
  headerContent: EmptyHeader,
  timeGridEvent: PlannerTimeGridEvent,
};

type RevisionCalendarColumnProps = {
  revision: Revision;
  savedRevision?: Revision;
  selectedDate: string;
  config?: ClientConfig;
  isEditable: boolean;
  compact?: boolean;
  showCurrentTimeLine: boolean;
  showHistory?: boolean;
  onDraftCreate?: (input: DraftBlockInput) => Block;
  onDraftUpdate?: (blockId: string, payload: Record<string, unknown>) => void;
  onDraftDelete?: (blockId: string) => void;
};

function RevisionCalendarColumn(props: RevisionCalendarColumnProps) {
  const themeMode = useThemeMode();
  const slotStep = Math.max(5, props.config?.rounding_interval ?? 15);
  const timeWindow = revisionTimeWindow({
    revision: props.revision,
    config: props.config,
    slotStep,
    compact: props.compact ?? false,
  });
  // The React adapter initializes config/plugins once. Recreate that runtime
  // only for structural changes; ordinary block edits still use set(events).
  const runtimeKey = JSON.stringify([
    props.selectedDate,
    timeWindow,
    slotStep,
    scheduleGridStep(props.config?.rounding_interval),
    props.config?.time_format ?? "24h",
    props.isEditable,
    props.showCurrentTimeLine,
    themeMode,
  ]);
  return (
    <RevisionCalendarRuntime
      key={runtimeKey}
      {...props}
      timeWindow={timeWindow}
    />
  );
}

function RevisionCalendarRuntime({
  revision,
  savedRevision,
  selectedDate,
  config,
  isEditable,
  compact = false,
  showCurrentTimeLine,
  showHistory = false,
  onDraftCreate,
  onDraftUpdate,
  onDraftDelete,
  timeWindow,
}: RevisionCalendarColumnProps & {
  timeWindow: ReturnType<typeof revisionTimeWindow>;
}) {
  const themeMode = useThemeMode();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [editorState, setEditorState] = useState<InlineEditorState | null>(
    null,
  );
  const [dragSelection, setDragSelection] = useState<DragSelectionState | null>(
    null,
  );
  const dragRef = useRef<DragSelectionState | null>(null);
  const blockDrag = useRef<BlockDrag | null>(null);
  const blockDragFrame = useRef(0);
  const [blockPreview, setBlockPreview] = useState<{
    items: { block: Block; style: CSSProperties }[];
    error?: string;
  } | null>(null);
  const slotStep = Math.max(5, config?.rounding_interval ?? 15);
  const gridStep = scheduleGridStep(config?.rounding_interval);
  const defaultDuration = config?.default_duration ?? 60;
  const timeFormat = config?.time_format ?? "24h";
  const { startBoundary, endBoundary, gridHeight, eventWidth } = timeWindow;
  const span = endBoundary - startBoundary;
  const editingBlock = useMemo(
    () =>
      editorState
        ? (revision.blocks.find((block) => block.id === editorState.blockId) ??
          null)
        : null,
    [editorState, revision.blocks],
  );
  const visibleEditorState = editorState && editingBlock ? editorState : null;

  // ── Stable refs for volatile values so Schedule-X callbacks stay current ──
  // useCalendarApp creates the calendar once (empty deps) so all callbacks
  // captured at mount time must read from refs to avoid stale closures.
  const latestRef = useRef({
    isEditable,
    onDraftCreate,
    slotStep,
    startBoundary,
    endBoundary,
    config,
    defaultDuration,
  });
  useEffect(() => {
    latestRef.current = {
      isEditable,
      onDraftCreate,
      slotStep,
      startBoundary,
      endBoundary,
      config,
      defaultDuration,
    };
  });

  const eventsServicePlugin = useMemo(() => createEventsServicePlugin(), []);

  const plugins = useMemo(() => {
    return showCurrentTimeLine ? [eventsServicePlugin, createCurrentTimePlugin()] : [eventsServicePlugin];
  }, [eventsServicePlugin, showCurrentTimeLine]);

  const startBlockDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isEditable || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
    const id = event.target.closest('.sx__time-grid-event')?.getAttribute('data-event-id');
    const block = revision.blocks.find((candidate) => candidate.id === id);
    if (!block) return;
    blockDrag.current = {
      pointerId: event.pointerId,
      block,
      resize: Boolean(event.target.closest('.sx__time-grid-event-resize-handle')),
      originY: event.clientY,
      originScroll: event.currentTarget.scrollTop,
      clientY: event.clientY,
      active: false,
    };
  };

  const dragOffset = (drag: BlockDrag, column: HTMLDivElement) => {
    const deltaY = drag.clientY - drag.originY + column.scrollTop - drag.originScroll;
    return Math.round(deltaY * span / gridHeight / slotStep) * slotStep;
  };

  const dragTiming = (drag: BlockDrag, offset: number): BlockTiming => {
    const { start, duration } = drag.block;
    if (offset === 0) return { start, duration };
    const minutes = parseTime(start);
    if (drag.resize) {
      return { start, duration: Math.min(endBoundary - minutes, clampDuration(duration + offset, config)) };
    }
    const next = Math.max(startBoundary, Math.min(endBoundary - duration, minutes + offset));
    return { start: formatTime(next), duration };
  };

  const updateBlockPreview = (column: HTMLDivElement) => {
    cancelAnimationFrame(blockDragFrame.current);
    blockDragFrame.current = requestAnimationFrame(() => {
      const drag = blockDrag.current;
      if (!drag?.active) return;
      const offset = dragOffset(drag, column);
      const grid = column.querySelector('.sx__time-grid-day');
      const surface = surfaceRef.current;
      if (!grid || !surface) return;
      if (drag.offset !== offset) {
        drag.offset = offset;
        const timing = dragTiming(drag, offset);
        const original = new Map(revision.blocks.map((block) => [block.id, block]));
        try {
          const blocks = applyDraftUpdate(revision.blocks, drag.block.id, timing).filter((block) => {
            const before = original.get(block.id);
            return block.id === drag.block.id || before?.start !== block.start || before?.duration !== block.duration;
          });
          drag.preview = { blocks };
        } catch (error) {
          drag.preview = {
            blocks: [{ ...drag.block, ...timing }],
            error: error instanceof Error ? error.message : 'This change does not fit.',
          };
        }
      }
      const area = surface.getBoundingClientRect();
      const day = grid.getBoundingClientRect();
      if (drag.preview) setBlockPreview({
        error: drag.preview.error,
        items: drag.preview.blocks.map((block) => {
          const start = parseTime(block.start);
          const anchor = selectionAnchor({ dayRect: day, startMinutes: start, endMinutes: start + block.duration, startBoundary, endBoundary });
          return { block, style: {
            left: anchor.left - area.left,
            top: anchor.top - area.top,
            width: anchor.width * eventWidth / 100,
            height: anchor.height,
          } };
        }),
      });
      const scroller = column.getBoundingClientRect();
      const top = Math.max(0, scroller.top);
      const bottom = Math.min(window.innerHeight, scroller.bottom);
      const edge = 28;
      const rate = drag.clientY < top + edge ? -8 : drag.clientY > bottom - edge ? 8 : 0;
      const before = column.scrollTop;
      if (rate) column.scrollTop += rate;
      if (column.scrollTop !== before) updateBlockPreview(column);
    });
  };

  const moveBlockDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = blockDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.clientY = event.clientY;
    if (!drag.active) {
      if (Math.abs(event.clientY - drag.originY) < 4) return;
      drag.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    updateBlockPreview(event.currentTarget);
  };

  const resetBlockDrag = () => {
    blockDrag.current = null;
    cancelAnimationFrame(blockDragFrame.current);
    setBlockPreview(null);
  };

  const finishBlockDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = blockDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resetBlockDrag();
    if (!drag.active || !isEditable || !onDraftUpdate) return;

    drag.clientY = event.clientY;
    const timing = dragTiming(drag, dragOffset(drag, event.currentTarget));
    if (timing.start !== drag.block.start || timing.duration !== drag.block.duration) onDraftUpdate(drag.block.id, timing);
  };

  const cancelBlockDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (blockDrag.current?.pointerId === event.pointerId) resetBlockDrag();
  };

  useEffect(() => () => cancelAnimationFrame(blockDragFrame.current), []);

  const events = useMemo(
    () =>
      revision.blocks.map((block) =>
        buildScheduleEvent({
          block,
          revision,
          selectedDate,
          editable: isEditable,
          isUnsaved: Boolean(savedRevision && JSON.stringify(savedRevision.blocks.find((saved) => saved.id === block.id)) !== JSON.stringify(block)),
          timeFormat,
        }),
      ),
    [isEditable, revision, savedRevision, selectedDate, timeFormat],
  );

  const openEditor = useCallback(
    (blockId: string, isNew: boolean, anchor?: InlineEditorAnchor) => {
      const fallbackElement = findBlockElement(surfaceRef.current, blockId);
      const resolvedAnchor =
        anchor ??
        (fallbackElement
          ? elementAnchor(fallbackElement)
          : { top: 120, left: 120, width: 240, height: 80 });

      setEditorState({ blockId, isNew, anchor: resolvedAnchor });
    },
    [],
  );
  const openEditorRef = useRef(openEditor);
  useEffect(() => {
    openEditorRef.current = openEditor;
  });

  // ── Calendar config ──
  // useCalendarApp creates the calendar ONCE (empty useEffect deps).
  // All callbacks are captured at mount and never refreshed, so we
  // read volatile values from latestRef / openEditorRef inside them.
  const calendarConfig = useMemo<CalendarConfig>(
    () => ({
      views: [dayView],
      defaultView: dayView.name,
      selectedDate: Temporal.PlainDate.from(selectedDate),
      events,
      timezone: localTimezone,
      isDark: themeMode === "dark",
      dayBoundaries: {
        start: formatDayBoundary(startBoundary),
        end: formatDayBoundary(endBoundary),
      },
      calendars: sharedCalendars,
      weekOptions: {
        gridHeight,
        nDays: 1,
        eventWidth,
        eventOverlap: false,
        gridStep,
        timeAxisFormatOptions:
          timeFormat === "12h"
            ? { hour: "numeric", minute: "2-digit", hour12: true }
            : { hour: "2-digit", minute: "2-digit", hour12: false },
      },
      callbacks: {
        onMouseDownDateTime: (_, mouseDownEvent) => {
          const ctx = latestRef.current;
          if (
            !ctx.isEditable ||
            !ctx.onDraftCreate ||
            mouseDownEvent.button !== 0
          ) {
            return;
          }

          const target =
            mouseDownEvent.target instanceof Element
              ? mouseDownEvent.target
              : null;
          if (target?.closest(".sx__time-grid-event")) {
            return;
          }

          const dayElement = target?.closest(".sx__time-grid-day");
          if (!(dayElement instanceof HTMLElement)) {
            return;
          }

          mouseDownEvent.preventDefault();
          const dayRect = dayElement.getBoundingClientRect();
          const surfaceRect = surfaceRef.current?.getBoundingClientRect();
          if (!surfaceRect) {
            return;
          }
          const startMin = pointerToMinutes({
            clientY: mouseDownEvent.clientY,
            dayRect,
            startBoundary: ctx.startBoundary,
            endBoundary: ctx.endBoundary,
            slotStep: ctx.slotStep,
          });

          const initial: DragSelectionState = {
            dayRect,
            surfaceRect,
            startMinutes: startMin,
            endMinutes: startMin,
          };
          dragRef.current = initial;
          setDragSelection(initial);

          // ── Register listeners synchronously so mouseup is caught ──
          // In a quick click, mousedown and mouseup fire in the same
          // browser task.  A useEffect-based listener would only register
          // after the next React render — too late for the mouseup.
          const handleMouseMove = (event: MouseEvent) => {
            const c = latestRef.current;
            const next: DragSelectionState | null = dragRef.current
              ? {
                  ...dragRef.current,
                  endMinutes: pointerToMinutes({
                    clientY: event.clientY,
                    dayRect: dragRef.current.dayRect,
                    startBoundary: c.startBoundary,
                    endBoundary: c.endBoundary,
                    slotStep: c.slotStep,
                  }),
                }
              : null;
            dragRef.current = next;
            setDragSelection(next);
          };

          const handleMouseUp = () => {
            document.removeEventListener("mousemove", handleMouseMove);

            const current = dragRef.current;
            dragRef.current = null;
            setDragSelection(null);

            const c = latestRef.current;
            if (!current || !c.onDraftCreate) {
              return;
            }

            const moved =
              Math.abs(current.endMinutes - current.startMinutes) >= c.slotStep;
            const nextStart = Math.min(
              current.startMinutes,
              current.endMinutes,
            );
            const nextDuration = moved
              ? clampDuration(
                  Math.abs(current.endMinutes - current.startMinutes),
                  c.config,
                )
              : clampDuration(c.defaultDuration, c.config);
            const block = c.onDraftCreate({
              label: "New block",
              start: formatTime(nextStart),
              duration: nextDuration,
              type: c.config?.default_type ?? "focus",
            });

            const anchor = selectionAnchor({
              dayRect: current.dayRect,
              startMinutes: nextStart,
              endMinutes: nextStart + nextDuration,
              startBoundary: c.startBoundary,
              endBoundary: c.endBoundary,
            });

            // Defer the editor open to the next event-loop tick.  onDraftCreate
            // queued parent state updates; React flushes them before the timeout
            // fires, so revision.blocks already contains the new block.
            setTimeout(() => openEditorRef.current(block.id, true, anchor), 0);
          };

          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp, { once: true });
        },
        onEventClick: (event, uiEvent) => {
          if (!latestRef.current.isEditable || !event.block) {
            return;
          }

          const target =
            uiEvent.target instanceof Element
              ? uiEvent.target.closest("[data-block-id]")
              : null;
          openEditorRef.current(
            event.block.id,
            false,
            target instanceof HTMLElement ? elementAnchor(target) : undefined,
          );
        },
        onDoubleClickEvent: (event, uiEvent) => {
          if (!latestRef.current.isEditable || !event.block) {
            return;
          }

          const target =
            uiEvent.target instanceof Element
              ? uiEvent.target.closest("[data-block-id]")
              : null;
          openEditorRef.current(
            event.block.id,
            false,
            target instanceof HTMLElement ? elementAnchor(target) : undefined,
          );
        },
      },
    }),
    // Only structural layout values — no events, no callback identities.
    // Events are synced reactively via the events service below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedDate,
      startBoundary,
      endBoundary,
      gridStep,
      gridHeight,
      eventWidth,
      timeFormat,
      themeMode,
    ],
  );

  const calendarApp = useCalendarApp(calendarConfig, plugins);

  useEffect(() => {
    if (!calendarApp) return;
    const column = surfaceRef.current?.querySelector<HTMLElement>(
      '[data-testid="planner-calendar-column"]',
    );
    if (!column) return;
    let frame = 0;
    let aligned = false;
    const syncGrid = () => {
      // Schedule-X mounts its grid after the React adapter. Style its built-in
      // labels once the grid is present, and wait for scrollable content before
      // aligning the active day to the current hour.
      const hours =
        surfaceRef.current?.querySelectorAll<HTMLElement>(
          ".sx__week-grid__hour",
        ) ?? [];
      hours.forEach((hour, index) => {
        const label = hour.querySelector<HTMLElement>(
          ".sx__week-grid__hour-text",
        );
        if (!label) return;
        const minuteOfDay = startBoundary + index * gridStep;
        label.classList.add("planner-time-label");
        label.classList.toggle(
          "planner-time-label--hour",
          minuteOfDay % 60 === 0,
        );
        label.classList.toggle(
          "planner-time-label--half",
          minuteOfDay % 60 === 30,
        );
        label.classList.toggle(
          "planner-time-label--quarter",
          minuteOfDay % 30 !== 0,
        );
      });

      if (!compact && !aligned && column.scrollHeight > column.clientHeight) {
        const now = new Date();
        const preferredMinutes =
          selectedDate === todayString()
            ? floorToHour(now.getHours() * 60 + now.getMinutes() - 60)
            : startBoundary;
        const minutes = Math.max(
          startBoundary,
          Math.min(preferredMinutes, endBoundary),
        );
        column.scrollTop =
          ((minutes - startBoundary) / (endBoundary - startBoundary)) *
          gridHeight;
        aligned = true;
      }

      const expectedHours = Math.ceil((endBoundary - startBoundary) / gridStep);
      if (
        hours.length >= expectedHours &&
        (compact || aligned || column.scrollHeight <= column.clientHeight)
      ) {
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncGrid);
    });
    observer.observe(column, { childList: true, subtree: true });
    frame = requestAnimationFrame(syncGrid);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [
    calendarApp,
    compact,
    selectedDate,
    startBoundary,
    endBoundary,
    gridHeight,
    gridStep,
  ]);

  // useCalendarApp ignores config changes after mount, so the initial
  // events are set from the config and all subsequent updates go through
  // the events service plugin to avoid full calendar re-creation.
  useEffect(() => {
    if (calendarApp) {
      eventsServicePlugin.set(events);
    }
  }, [calendarApp, events, eventsServicePlugin]);
  const selectionPreview =
    dragSelection && isEditable
      ? selectionAnchor({
          dayRect: dragSelection.dayRect,
          startMinutes: dragSelection.startMinutes,
          endMinutes:
            dragSelection.endMinutes === dragSelection.startMinutes
              ? dragSelection.startMinutes + slotStep
              : dragSelection.endMinutes,
          startBoundary,
          endBoundary,
        })
      : null;
  const scheduleSurfaceStyle = useMemo<CSSProperties>(() => {
    const gridSteps = Math.max(
      1,
      Math.ceil((endBoundary - startBoundary) / gridStep),
    );

    return {
      "--sx-week-grid-height": `${gridHeight}px`,
      "--sx-week-grid-hour-height": `${gridHeight / gridSteps}px`,
    } as CSSProperties;
  }, [endBoundary, gridHeight, gridStep, startBoundary]);
  const selectionPreviewStyle =
    selectionPreview && dragSelection
      ? {
          left: selectionPreview.left - dragSelection.surfaceRect.left,
          top: selectionPreview.top - dragSelection.surfaceRect.top,
          width: selectionPreview.width,
          height: Math.max(selectionPreview.height, 32),
        }
      : null;

  return (
    <div
      ref={surfaceRef}
      className={cn(
        "planner-calendar__surface relative",
        compact && "planner-calendar__surface--compact",
        isEditable
          ? "planner-calendar__surface--active"
          : "planner-calendar__surface--readonly",
      )}
      style={scheduleSurfaceStyle}
    >
      <div
        className={cn(
          "planner-calendar__column",
          compact && "planner-calendar__column--compact",
        )}
        data-testid="planner-calendar-column"
        onPointerDown={startBlockDrag}
        onPointerMove={moveBlockDrag}
        onPointerUp={finishBlockDrag}
        onPointerCancel={cancelBlockDrag}
        onLostPointerCapture={cancelBlockDrag}
        onScroll={(event) => { if (blockDrag.current?.active) updateBlockPreview(event.currentTarget); }}
      >
        <ScheduleXCalendar
          calendarApp={calendarApp}
          customComponents={scheduleXCustomComponents}
        />
      </div>
      {blockPreview && isEditable && <div className="planner-gesture-preview" data-testid="calendar-gesture-preview" aria-hidden="true">
        {blockPreview.items.map(({ block, style }) => (
          <div key={block.id} className={cn('planner-gesture-preview__block', blockPreview.error && 'status-danger')} style={style}>
            <strong>{block.label}</strong> <span>{formatClockLabel(block.start, timeFormat)}</span>
            {blockPreview.error && <span>{blockPreview.error}</span>}
          </div>
        ))}
      </div>}
      {selectionPreview ? (
        <div
          className="planner-calendar__selection pointer-events-none absolute rounded-[var(--db-radius)] border border-accent/60 bg-accent/15"
          style={selectionPreviewStyle ?? undefined}
        />
      ) : null}
      {visibleEditorState && editingBlock && isEditable ? (
        <PlannerInlineEditor
          key={`${visibleEditorState.blockId}:${editingBlock.start}:${editingBlock.duration}:${editingBlock.label}`}
          block={editingBlock}
          anchor={visibleEditorState.anchor}
          isNew={visibleEditorState.isNew}
          showHistory={showHistory}
          onSave={(payload) => {
            onDraftUpdate?.(editingBlock.id, {
              ...payload,
              duration: clampDuration(payload.duration, config),
            });
            setEditorState(null);
          }}
          onDelete={() => {
            onDraftDelete?.(editingBlock.id);
            setEditorState(null);
          }}
          onCancel={() => {
            if (visibleEditorState.isNew) {
              onDraftDelete?.(editingBlock.id);
            }
            setEditorState(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function PlannerCalendarView({
  historyRevisions,
  selectedDate,
  currentRevision,
  savedRevision,
  canEdit,
  isCommittingDraft,
  config,
  onDraftCreate,
  onDraftUpdate,
  onDraftDelete,
}: {
  historyRevisions: Revision[];
  selectedDate: string;
  currentRevision: Revision | null;
  savedRevision?: Revision;
  canEdit: boolean;
  isCommittingDraft: boolean;
  config?: ClientConfig;
  onDraftCreate: (input: DraftBlockInput) => Block;
  onDraftUpdate: (blockId: string, payload: Record<string, unknown>) => void;
  onDraftDelete: (blockId: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia?.("(max-width: 820px)").matches ?? false);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(max-width: 820px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const showCurrentTimeLine =
    selectedDate === todayString() && Boolean(config?.show_current_time_line ?? true);
  const orderedHistoryRevisions = useMemo(
    () => [...historyRevisions].reverse(),
    [historyRevisions],
  );

  const historyContent = <div className="grid max-h-[calc(100dvh-10rem)] gap-4 overflow-y-auto pr-1">
    {orderedHistoryRevisions.map((revision) => (
      <div key={revision.id} className="grid gap-3">
        <RevisionHeader revision={revision} isActive={false} />
        <RevisionCalendarColumn revision={revision} selectedDate={selectedDate} config={config} isEditable={false} compact showCurrentTimeLine={false} />
      </div>
    ))}
  </div>;

  return (
    <div className="planner-calendar grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {canEdit
            ? "Click or drag to plan your day. Edits stay in your draft until saved."
            : "Earlier intent is preserved in history."}
        </p>
        <Button
          ref={historyTrigger}
          variant="ghost"
          size="sm"
          onClick={() => setShowHistory((current) => !current)}
          disabled={historyRevisions.length === 0}
        >
          {showHistory ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          {showHistory ? "Hide history" : "Show history"}
        </Button>
      </div>

      <div
        className={cn(
          "grid gap-4",
          showHistory && !narrow && orderedHistoryRevisions.length > 0
            ? "xl:grid-cols-[minmax(0,1fr)_245px]"
            : "xl:grid-cols-1",
        )}
      >
        {showHistory && !narrow && orderedHistoryRevisions.length > 0 ? (
          <aside className="planner-calendar__history-panel order-2 grid gap-4 xl:order-2 xl:sticky xl:top-6 xl:self-start">
            <div className="flex items-center gap-2 px-1 text-sm text-ink">
              Plan revisions
            </div>
            {historyContent}
          </aside>
        ) : null}

        <section
          className="order-1 grid gap-3 min-w-0 w-full xl:order-1"
          data-testid="planner-calendar"
        >
          {currentRevision ? (
            <>
              <RevisionHeader revision={currentRevision} isActive={canEdit} />
              <RevisionCalendarColumn
                key={selectedDate}
                revision={currentRevision}
                savedRevision={savedRevision}
                selectedDate={selectedDate}
                config={config}
                isEditable={canEdit && !isCommittingDraft}
                showCurrentTimeLine={showCurrentTimeLine}
                showHistory={showHistory}
                onDraftCreate={onDraftCreate}
                onDraftUpdate={onDraftUpdate}
                onDraftDelete={onDraftDelete}
              />
            </>
          ) : (
            <div className="rounded-[var(--db-radius)] border border-dashed border-line bg-raised p-8 text-sm text-muted">
              No revision is available for this day yet.
            </div>
          )}
        </section>
      </div>
      <Dialog open={showHistory && narrow} onOpenChange={setShowHistory}>
        <DialogContent className="planner-history-drawer planner-calendar" onCloseAutoFocus={(event) => { event.preventDefault(); historyTrigger.current?.focus(); }}>
          <DialogTitle>Plan revisions</DialogTitle>
          <DialogDescription className="mb-6">Earlier plans remain available as saved revisions.</DialogDescription>
          {historyContent}
        </DialogContent>
      </Dialog>
    </div>
  );
}
