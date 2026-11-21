import type { Block, BlockStatus, BlockType } from '@/lib/api';
import { formatTime, parseTime } from '@/lib/utils';

export const DRAFT_BLOCK_PREFIX = 'draft-';

export type DraftBlockInput = {
  label: string;
  start: string;
  duration: number;
  type: BlockType;
  status?: BlockStatus;
  focus_rating?: number | null;
  next_action?: string | null;
  content_path?: string | null;
};

export type DraftOperation =
  | { type: 'create'; block: Block }
  | { type: 'update'; blockId: string; payload: Record<string, unknown> }
  | { type: 'delete'; blockId: string };

export function cloneBlock(block: Block): Block {
  return structuredClone(block);
}

export function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map(cloneBlock);
}

export function createDraftBlock(input: DraftBlockInput): Block {
  // randomUUID is secure-context-only; getRandomValues also works on HTTP LAN.
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
  return {
    id: `${DRAFT_BLOCK_PREFIX}${id}`,
    label: input.label,
    start: input.start,
    duration: input.duration,
    type: input.type,
    status: input.status ?? 'proposed',
    created_at: new Date().toISOString(),
    metadata: {},
    content_path: input.content_path ?? null,
    focus_rating: input.focus_rating ?? null,
    actual_duration: null,
    next_action: input.next_action ?? null,
    artifacts: [],
    reality: null,
  };
}

// Rust strings compare Unicode code points, not locale-dependent collation
// or JavaScript's UTF-16 ordering (which differs for supplementary characters).
function compareLabels(left: string, right: string) {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

export function normalizeDraftBlocks(blocks: Block[]) {
  return [...blocks].sort((left, right) => {
    const startDifference = parseTime(left.start) - parseTime(right.start);
    if (startDifference !== 0) {
      return startDifference;
    }
    return compareLabels(left.label, right.label);
  });
}

function coerceNullableString(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return String(value);
}

function coerceNullableNumber(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return Number(value);
}

function displaceOverlappingBlocks(blocks: Block[], movedBlockId: string) {
  const normalized = normalizeDraftBlocks(blocks);
  const movedIndex = normalized.findIndex((block) => block.id === movedBlockId);

  if (movedIndex < 0) {
    return normalized;
  }

  const movedBlock = normalized[movedIndex];
  if (movedBlock.status === 'cancelled') return normalized;
  const movedStart = parseTime(movedBlock.start);
  let currentEnd = movedStart + movedBlock.duration;

  for (const block of normalized) {
    if (block.id === movedBlockId || block.status === 'cancelled') {
      continue;
    }

    const blockStart = parseTime(block.start);
    const blockEnd = blockStart + block.duration;

    if (blockStart < currentEnd && blockEnd > movedStart) {
      if (currentEnd + block.duration > 1440) {
        throw new Error(`Displacing '${block.label}' would push it past 24:00.`);
      }
      block.start = formatTime(currentEnd);
      currentEnd += block.duration;
    }
  }

  return normalizeDraftBlocks(normalized);
}

function validateSchedule(block: Block) {
  const start = parseTime(block.start);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(block.start) || !Number.isInteger(block.duration) || block.duration < 1 || block.duration > 480 || start < 0 || start >= 1440) {
    throw new Error('Use a valid start time and a duration of 1–480 minutes.');
  }
  if (start + block.duration > 1440) throw new Error(`Block '${block.label}' would end after 24:00.`);
}

export function applyDraftCreate(blocks: Block[], block: Block) {
  validateSchedule(block);
  return normalizeDraftBlocks([...cloneBlocks(blocks), cloneBlock(block)]);
}

export function applyDraftDelete(blocks: Block[], blockId: string) {
  return blocks.filter((block) => block.id !== blockId).map(cloneBlock);
}

export function applyDraftUpdate(blocks: Block[], blockId: string, payload: Record<string, unknown>) {
  const nextBlocks = cloneBlocks(blocks);
  const target = nextBlocks.find((block) => block.id === blockId);

  if (!target) {
    return nextBlocks;
  }

  const previousStart = target.start;
  const previousDuration = target.duration;

  if (payload.label !== undefined) target.label = String(payload.label);
  if (payload.start !== undefined) target.start = String(payload.start);
  if (payload.duration !== undefined) target.duration = Number(payload.duration);
  if (payload.type !== undefined) target.type = payload.type as BlockType;
  if (payload.status !== undefined) target.status = payload.status as BlockStatus;

  const focusRating = coerceNullableNumber(payload.focus_rating);
  if (focusRating !== undefined) {
    target.focus_rating = focusRating;
  }

  const nextAction = coerceNullableString(payload.next_action);
  if (nextAction !== undefined) {
    target.next_action = nextAction;
  }

  const contentPath = coerceNullableString(payload.content_path);
  if (contentPath !== undefined) {
    target.content_path = contentPath;
  }

  for (const key of ['project_id', 'goal_id']) {
    if (payload[key] !== undefined) {
      if (payload[key] === null) delete target.metadata[key];
      else target.metadata[key] = String(payload[key]);
    }
  }
  validateSchedule(target);
  if (target.start !== previousStart || target.duration !== previousDuration) {
    return displaceOverlappingBlocks(nextBlocks, blockId);
  }

  return normalizeDraftBlocks(nextBlocks);
}
