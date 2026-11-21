import type { Block, BlockType, RevisionCopyMode } from '@/lib/api';
import type { BlockStatus } from '@/lib/api';
import { formatTime, parseTime } from '@/lib/utils';

export const typeOptions: BlockType[] = ['focus', 'shallow', 'urgent', 'break'];
export const statusOptions: BlockStatus[] = ['proposed', 'confirmed', 'cancelled', 'done'];
export const copyModeOptions: RevisionCopyMode[] = ['all', 'from_now', 'empty'];

export function labelTone(type: BlockType) {
  return `block-type block-type--${type}`;
}

export function dropZoneTone(active: boolean) {
  return active
    ? 'border-accent/70 bg-accent/15'
    : 'border-transparent bg-transparent hover:border-line hover:bg-raised';
}

export function startTimeForDrop(blocks: Block[], draggedBlockId: string, dropIndex: number) {
  const draggedBlock = blocks.find((block) => block.id === draggedBlockId);
  if (!draggedBlock) return null;

  const remainingBlocks = blocks.filter((block) => block.id !== draggedBlockId);
  const safeIndex = Math.max(0, Math.min(dropIndex, remainingBlocks.length));

  if (remainingBlocks.length === 0) {
    return draggedBlock.start;
  }

  if (safeIndex === 0) {
    return remainingBlocks[0]?.start ?? draggedBlock.start;
  }

  if (safeIndex >= remainingBlocks.length) {
    const previous = remainingBlocks.at(-1);
    if (!previous) return draggedBlock.start;
    return formatTime(parseTime(previous.start) + previous.duration);
  }

  return remainingBlocks[safeIndex]?.start ?? draggedBlock.start;
}

