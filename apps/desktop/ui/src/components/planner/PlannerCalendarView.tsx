import { useThemeMode } from "@/hooks/use-theme-mode";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
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
import { Eye, EyeOff, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

import type {
  Block,
  ClientConfig,
  Revision,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
const eventWidth = 96;

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

type InlineEditorState = { anchor: InlineEditorAnchor } & (
  | { blockId: string }
  | { initial: DraftBlockInput }
);

type PreviewBlock = Pick<Block, 'id' | 'label' | 'start' | 'duration'>;

type CalendarGesture = {
  pointerId: number;
  originY: number;
  originScroll: number;
  clientY: number;
  touchStarted?: number;
  active: boolean;
  offset?: number;
  preview?: { blocks: PreviewBlock[]; error?: string };
  previewPosition?: string;
} & ({ kind: 'create'; start: number } | { kind: 'move' | 'resize'; block: Block });

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
  const endMinutes = parseTime(block.start) + block.duration;
  // Schedule-X classifies a next-date midnight endpoint as a multi-day event.
  // Keep the display endpoint in the time grid while the block retains 24:00.
  const end = zonedDateTimeAt(selectedDate, formatTime(Math.min(1439, endMinutes)));

  return {
    id: block.id,
    title: block.label,
    start,
    end,
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
        endMinutes === 1440 ? "planner-calendar__event-shell--midnight" : "",
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
    formatDayBoundary(parseTime(block.start) + block.duration),
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
  initial,
  anchor,
  showHistory,
  onSave,
  onDelete,
  onCancel,
}: {
  block: Block | null;
  initial?: DraftBlockInput;
  anchor: InlineEditorAnchor;
  showHistory: boolean;
  onSave: (payload: ReturnType<typeof useBlockForm>['payload']) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const form = useBlockForm(block, initial);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const update = () => setPosition(plannerBlockAnchor(anchor, showHistory, editor.getBoundingClientRect()));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(editor);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [anchor, showHistory]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    editorRef.current
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
    return () => previousFocus?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        dirty || (event.target instanceof Node && editorRef.current?.contains(event.target))
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
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dirty, onCancel]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-label={block ? "Edit block" : "Draft block"}
      ref={editorRef}
      data-testid="planner-inline-editor"
      className="planner-calendar__inline-editor fixed z-40 rounded-[var(--db-radius)] border border-line bg-surface p-4 shadow-2xl shadow-black/40"
      style={position}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">
            {block ? "Edit block" : "Draft block"}
          </div>
          <div className="text-xs text-muted">
            Apply changes to your draft, then save the revised plan.
          </div>
        </div>
        <Badge className={cn("text-xs", labelTone(form.values.type))}>
          {form.values.type}
        </Badge>
      </div>
      <form
        className="grid gap-3"
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onSave(form.payload);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not apply this block.');
          }
        }}
      >
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <BlockFields form={form} compact />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div>{block && <Button variant="ghost" type="button" size="sm" onClick={onDelete}>Delete block</Button>}</div>
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
  return surface?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`) ?? null;
}

export function revisionTimeWindow({
  config,
  gridScale = 1,
}: {
  config?: ClientConfig;
  gridScale?: number;
}) {
  const startBoundary = (config?.start_hour ?? 0) * 60;
  const endBoundary = (config?.end_hour ?? 24) * 60;
  const defaultGridHeight = Math.max(
    900,
    (endBoundary - startBoundary) * Math.max(1, config?.pixels_per_minute ?? 1),
  );

  return {
    startBoundary,
    endBoundary,
    gridHeight: Math.round(defaultGridHeight * gridScale),
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
  showCurrentTimeLine: boolean;
  showHistory?: boolean;
  scrollPositions?: RefObject<Map<string, number>>;
  gridScale?: number;
  onColumnScroll?: (column: HTMLElement) => void;
  onDraftCreate?: (input: DraftBlockInput) => Block;
  onDraftUpdate?: (blockId: string, payload: Record<string, unknown>) => void;
  onDraftDelete?: (blockId: string) => void;
};

function RevisionCalendarColumn(props: RevisionCalendarColumnProps) {
  const themeMode = useThemeMode();
  const slotStep = Math.max(5, props.config?.rounding_interval ?? 15);
  const timeWindow = revisionTimeWindow({
    config: props.config,
    gridScale: props.gridScale,
  });
  // The React adapter initializes config/plugins once. Recreate that runtime
  // only for structural changes; ordinary block edits still use set(events).
  const runtimeKey = JSON.stringify([
    props.selectedDate,
    timeWindow,
    slotStep,
    scheduleGridStep(props.config?.rounding_interval),
    props.config?.time_format ?? "24h",
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
  showCurrentTimeLine,
  showHistory = false,
  scrollPositions,
  onColumnScroll,
  onDraftCreate,
  onDraftUpdate,
  onDraftDelete,
  timeWindow,
}: RevisionCalendarColumnProps & {
  timeWindow: ReturnType<typeof revisionTimeWindow>;
}) {
  const themeMode = useThemeMode();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [editorState, setEditorState] = useState<InlineEditorState | null>(
    null,
  );
  const blockDrag = useRef<CalendarGesture | null>(null);
  const blockDragFrame = useRef(0);
  const [blockPreview, setBlockPreview] = useState<{
    items: { block: PreviewBlock; style: CSSProperties }[];
    error?: string;
  } | null>(null);
  const slotStep = Math.max(5, config?.rounding_interval ?? 15);
  const gridStep = scheduleGridStep(config?.rounding_interval);
  const defaultDuration = config?.default_duration ?? 60;
  const timeFormat = config?.time_format ?? "24h";
  const { startBoundary, endBoundary, gridHeight } = timeWindow;
  const span = endBoundary - startBoundary;
  const editingBlock = useMemo(
    () =>
      editorState && 'blockId' in editorState
        ? (revision.blocks.find((block) => block.id === editorState.blockId) ??
          null)
        : null,
    [editorState, revision.blocks],
  );
  const editingInitial = editorState && 'initial' in editorState ? editorState.initial : undefined;

  const eventsServicePlugin = useMemo(() => createEventsServicePlugin(), []);

  const plugins = useMemo(() => {
    return showCurrentTimeLine ? [eventsServicePlugin, createCurrentTimePlugin()] : [eventsServicePlugin];
  }, [eventsServicePlugin, showCurrentTimeLine]);

  const startBlockDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isEditable || editorState || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
    const grid = event.target.closest('.sx__time-grid-day');
    if (!grid) return;
    const id = event.target.closest('.sx__time-grid-event')?.getAttribute('data-event-id');
    const block = revision.blocks.find((candidate) => candidate.id === id);
    if (id && !block) return;
    blockDrag.current = {
      pointerId: event.pointerId,
      originY: event.clientY,
      originScroll: event.currentTarget.scrollTop,
      clientY: event.clientY,
      touchStarted: event.pointerType === 'touch' ? event.timeStamp : undefined,
      active: false,
      ...(block ? {
        kind: event.target.closest('.sx__time-grid-event-resize-handle') ? 'resize' : 'move',
        block,
      } : {
        kind: 'create',
        start: pointerToMinutes({ clientY: event.clientY, dayRect: grid.getBoundingClientRect(), startBoundary, endBoundary, slotStep }),
      }),
    };
  };

  const dragOffset = (drag: CalendarGesture, column: HTMLDivElement) => {
    const deltaY = drag.clientY - drag.originY + column.scrollTop - drag.originScroll;
    return Math.round(deltaY * span / gridHeight / slotStep) * slotStep;
  };

  const dragTiming = (drag: CalendarGesture, offset: number): BlockTiming => {
    if (drag.kind === 'create') {
      const end = Math.max(startBoundary, Math.min(endBoundary, drag.start + offset));
      const start = Math.min(drag.start, end);
      const duration = clampDuration(Math.abs(end - drag.start) || defaultDuration, config);
      return { start: formatTime(start), duration: Math.min(duration, endBoundary - start) };
    }
    const { start, duration } = drag.block;
    if (offset === 0) return { start, duration };
    const minutes = parseTime(start);
    if (drag.kind === 'resize') {
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
      const changed = drag.offset !== offset;
      if (changed) {
        drag.offset = offset;
        const timing = dragTiming(drag, offset);
        if (drag.kind === 'create') {
          drag.preview = { blocks: [{ id: 'new-block', label: 'New block', ...timing }] };
        } else {
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
      }
      const area = surface.getBoundingClientRect();
      const day = grid.getBoundingClientRect();
      const position = [day.left - area.left, day.top - area.top, day.width, day.height].join(',');
      if (drag.preview && (changed || position !== drag.previewPosition)) {
        drag.previewPosition = position;
        setBlockPreview({
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
      }
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
      if (drag.kind === 'create' && drag.touchStarted !== undefined && event.timeStamp - drag.touchStarted < 350) return;
      drag.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    updateBlockPreview(event.currentTarget);
  };

  const resetBlockDrag = useCallback(() => {
    const pointerId = blockDrag.current?.pointerId;
    blockDrag.current = null;
    cancelAnimationFrame(blockDragFrame.current);
    setBlockPreview(null);
    if (pointerId !== undefined && columnRef.current?.hasPointerCapture(pointerId)) {
      columnRef.current.releasePointerCapture(pointerId);
    }
  }, []);

  const finishBlockDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = blockDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resetBlockDrag();
    if (!isEditable) return;

    drag.clientY = event.clientY;
    const timing = dragTiming(drag, drag.active ? dragOffset(drag, event.currentTarget) : 0);
    if (drag.kind === 'create') {
      const grid = event.currentTarget.querySelector('.sx__time-grid-day');
      if (!grid || !onDraftCreate) return;
      const startMinutes = parseTime(timing.start);
      setEditorState({
        initial: { ...timing, label: '', type: config?.default_type ?? 'focus' },
        anchor: selectionAnchor({ dayRect: grid.getBoundingClientRect(), startMinutes, endMinutes: startMinutes + timing.duration, startBoundary, endBoundary }),
      });
      return;
    }
    if (!drag.active || !onDraftUpdate) return;
    if (timing.start !== drag.block.start || timing.duration !== drag.block.duration) {
      try {
        onDraftUpdate(drag.block.id, timing);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'This change does not fit.');
      }
    }
  };

  const cancelBlockDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (blockDrag.current?.pointerId === event.pointerId) resetBlockDrag();
  };

  useEffect(() => {
    const column = columnRef.current;
    const preventPanDuringLongPress = (event: TouchEvent) => {
      const drag = blockDrag.current;
      if (drag?.kind === 'create' && drag.touchStarted !== undefined && event.timeStamp - drag.touchStarted >= 350 && event.cancelable) {
        event.preventDefault();
      }
    };
    const cancelWithEscape = (event: KeyboardEvent) => {
      if (blockDrag.current && event.key === 'Escape') {
        event.preventDefault();
        resetBlockDrag();
      }
    };
    column?.addEventListener('touchmove', preventPanDuringLongPress, { passive: false });
    window.addEventListener('blur', resetBlockDrag);
    document.addEventListener('keydown', cancelWithEscape);
    return () => {
      cancelAnimationFrame(blockDragFrame.current);
      column?.removeEventListener('touchmove', preventPanDuringLongPress);
      window.removeEventListener('blur', resetBlockDrag);
      document.removeEventListener('keydown', cancelWithEscape);
    };
  }, [resetBlockDrag]);

  const events = useMemo(() => {
    const saved = new Map(savedRevision?.blocks.map((block) => [block.id, block]));
    return revision.blocks.map((block) =>
        buildScheduleEvent({
          block,
          revision,
          selectedDate,
          editable: isEditable,
          isUnsaved: Boolean(savedRevision && JSON.stringify(saved.get(block.id)) !== JSON.stringify(block)),
          timeFormat,
        }),
    );
  }, [isEditable, revision, savedRevision, selectedDate, timeFormat]);
  const eventsRef = useRef(events);
  const calendarRendered = useRef(false);
  useLayoutEffect(() => {
    eventsRef.current = events;
    if (calendarRendered.current) eventsServicePlugin.set(events);
  }, [events, eventsServicePlugin]);

  const openEditor = useCallback(
    (blockId: string) => {
      const fallbackElement = findBlockElement(surfaceRef.current, blockId);
      if (fallbackElement) setEditorState({ blockId, anchor: elementAnchor(fallbackElement) });
    },
    [],
  );
  // ── Calendar config ──
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
        onRender: () => {
          // The adapter can expose a CalendarApp before its plugins are ready.
          calendarRendered.current = true;
          eventsServicePlugin.set(eventsRef.current);
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
      timeFormat,
      themeMode,
      eventsServicePlugin,
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

      if (!aligned && column.scrollHeight > column.clientHeight) {
        const now = new Date();
        const preferredMinutes = scrollPositions?.current.get(selectedDate) ??
          (selectedDate === todayString()
            ? floorToHour(now.getHours() * 60 + now.getMinutes() - 60)
            : startBoundary);
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
        (aligned || column.scrollHeight <= column.clientHeight)
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
    selectedDate,
    startBoundary,
    endBoundary,
    gridHeight,
    gridStep,
    scrollPositions,
  ]);

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

  return (
    <div
      ref={surfaceRef}
      className={cn(
        "planner-calendar__surface relative",
        !isEditable && "planner-calendar__surface--readonly",
      )}
      style={scheduleSurfaceStyle}
    >
      <div
        ref={columnRef}
        className="planner-calendar__column"
        data-testid="planner-calendar-column"
        onPointerDown={startBlockDrag}
        onPointerMove={moveBlockDrag}
        onPointerUp={finishBlockDrag}
        onPointerCancel={cancelBlockDrag}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) cancelBlockDrag(event);
        }}
        onScroll={(event) => {
          const column = event.currentTarget;
          scrollPositions?.current.set(selectedDate, startBoundary + column.scrollTop * span / gridHeight);
          onColumnScroll?.(column);
          if (blockDrag.current?.active) updateBlockPreview(column);
        }}
        onKeyDownCapture={(event) => {
          if (!isEditable || event.repeat || (event.key !== 'Enter' && event.key !== ' ') || !(event.target instanceof Element)) return;
          const id = event.target.closest('.sx__time-grid-event')?.getAttribute('data-event-id');
          if (!id) return;
          // Cancel the activating key before the editor's focused input can submit.
          event.preventDefault();
          event.stopPropagation();
          openEditor(id);
        }}
        onClickCapture={(event) => {
          if (!isEditable || editorState || !(event.target instanceof Element)) return;
          const id = event.target.closest('.sx__time-grid-event')?.getAttribute('data-event-id');
          if (id) openEditor(id);
        }}
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
      {editorState && (editingBlock || editingInitial) && isEditable ? (
        <PlannerInlineEditor
          key={editingBlock?.id ?? 'new-block'}
          block={editingBlock}
          initial={editingInitial}
          anchor={editorState.anchor}
          showHistory={showHistory}
          onSave={(payload) => {
            if (editingBlock) onDraftUpdate?.(editingBlock.id, payload);
            else if (editingInitial) onDraftCreate?.(payload);
            setEditorState(null);
          }}
          onDelete={() => {
            if (editingBlock) onDraftDelete?.(editingBlock.id);
            setEditorState(null);
          }}
          onCancel={() => setEditorState(null)}
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
  scrollPositions,
  gridScale = 1,
  onGridScaleChange,
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
  scrollPositions?: RefObject<Map<string, number>>;
  gridScale?: number;
  onGridScaleChange?: (value: number) => void;
  onDraftCreate: (input: DraftBlockInput) => Block;
  onDraftUpdate: (blockId: string, payload: Record<string, unknown>) => void;
  onDraftDelete: (blockId: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const stripId = useId();
  const stripRef = useRef<HTMLElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const mirroredScrolls = useRef(new WeakMap<HTMLElement, number>());
  const historyVisible = showHistory && historyRevisions.length > 0;
  const showCurrentTimeLine =
    selectedDate === todayString() && Boolean(config?.show_current_time_line ?? true);
  const orderedHistoryRevisions = useMemo(
    () => [...historyRevisions].reverse(),
    [historyRevisions],
  );

  const syncColumnScroll = (source: HTMLElement) => {
    const top = source.scrollTop;
    const mirrored = mirroredScrolls.current.get(source);
    mirroredScrolls.current.delete(source);
    // Assigning scrollTop dispatches another scroll event on the receiving column.
    if (top === mirrored) return;
    for (const column of stripRef.current?.querySelectorAll<HTMLElement>('.planner-calendar__column') ?? []) {
      if (column === source || column.scrollTop === top) continue;
      column.scrollTop = top;
      mirroredScrolls.current.set(column, column.scrollTop);
    }
  };

  return (
    <div className="planner-calendar grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="planner-calendar__hint mr-auto text-xs text-muted">
          {canEdit
            ? "Click or drag to plan your day. Edits stay in your draft until saved."
            : "Earlier intent is preserved in history."}
        </p>
        {onGridScaleChange && <div role="group" aria-label="Calendar zoom" className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" aria-label="Zoom out" title="Zoom out" disabled={gridScale <= 0.5} onClick={() => onGridScaleChange(gridScale - 0.25)}>
            <Minus aria-hidden="true" className="size-4" />
          </Button>
          <span className="min-w-9 text-center text-xs tabular-nums text-muted">{gridScale * 100}%</span>
          <Button variant="outline" size="sm" aria-label="Zoom in" title="Zoom in" disabled={gridScale >= 2} onClick={() => onGridScaleChange(gridScale + 0.25)}>
            <Plus aria-hidden="true" className="size-4" />
          </Button>
        </div>}
        <Button
          ref={historyTrigger}
          variant="ghost"
          size="sm"
          onClick={() => setShowHistory((current) => !current)}
          disabled={historyRevisions.length === 0}
          aria-expanded={historyVisible}
          aria-controls={stripId}
        >
          {historyVisible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          {historyVisible ? "Hide history" : "Show history"}
        </Button>
      </div>

      <section
        ref={stripRef}
        id={stripId}
        aria-label={historyVisible ? "Plan revisions" : undefined}
        tabIndex={historyVisible ? 0 : undefined}
        className={cn("grid min-w-0", historyVisible && "planner-calendar__revision-strip")}
        onKeyDown={(event) => {
          if (!historyVisible || event.key !== "Escape" || event.target !== event.currentTarget) return;
          event.preventDefault();
          setShowHistory(false);
          historyTrigger.current?.focus();
        }}
      >
        <section
          aria-label={currentRevision ? `Revision ${currentRevision.id}` : undefined}
          className="planner-calendar__revision grid min-w-0 gap-3"
          data-testid="planner-calendar"
        >
          {currentRevision ? (
            <>
              <RevisionHeader revision={currentRevision} isActive />
              <RevisionCalendarColumn
                key={selectedDate}
                revision={currentRevision}
                savedRevision={savedRevision}
                selectedDate={selectedDate}
                config={config}
                scrollPositions={scrollPositions}
                gridScale={gridScale}
                isEditable={canEdit && !isCommittingDraft}
                showCurrentTimeLine={showCurrentTimeLine}
                showHistory={historyVisible}
                onColumnScroll={historyVisible ? syncColumnScroll : undefined}
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
        {historyVisible && orderedHistoryRevisions.map((revision) => (
          <section key={revision.id} aria-label={`Revision ${revision.id}`} className="planner-calendar__revision grid min-w-0 gap-3">
            <RevisionHeader revision={revision} isActive={false} />
            <RevisionCalendarColumn
              revision={revision}
              selectedDate={selectedDate}
              config={config}
              scrollPositions={scrollPositions}
              gridScale={gridScale}
              isEditable={false}
              showCurrentTimeLine={false}
              onColumnScroll={syncColumnScroll}
            />
          </section>
        ))}
      </section>
    </div>
  );
}
