import fc from 'fast-check';
import { expect, it } from 'vitest';
import type { Block } from '@/lib/api';
import {
  applyDraftCreate,
  applyDraftDelete,
  applyDraftUpdate,
  normalizeDraftBlocks,
} from './calendarDraft';

// Keep mutation runs reproducible. fast-check reports the seed and shrink path
// for a failing case; change the seed deliberately when exploring more cases.
const runs = { numRuns: 100, seed: 20261009 };
const minute = fc.integer({ min: 0, max: 1439 });
const duration = fc.integer({ min: 1, max: 480 });
const scalar = fc.oneof(
  fc.integer({ min: 0, max: 0xd7ff }),
  fc.integer({ min: 0xe000, max: 0x10ffff }),
);
const label = fc.array(scalar, { maxLength: 8 }).map((points) => String.fromCodePoint(...points));
const utf8SortKey = (text: string) => Array.from(new TextEncoder().encode(text),
  (byte) => byte.toString(16).padStart(2, '0')).join('');
const time = (minutes: number) => `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
const block = (id: string, start: number, length = 1, text = id): Block => ({
  id,
  label: text,
  start: time(start),
  duration: length,
  type: 'focus',
  status: 'proposed',
  created_at: '2026-10-09T00:00:00Z',
  metadata: { links: ['saved'], project_id: 'original' },
  content_path: null,
  focus_rating: null,
  actual_duration: null,
  next_action: null,
  artifacts: [],
  reality: null,
});

it('normalizes generated schedules by time and Unicode scalar label order, retaining equal-key order', () => {
  const schedule = fc.tuple(minute, fc.array(fc.record({ offset: fc.integer({ min: 0, max: 3 }), label }), { maxLength: 30 }))
    .map(([anchor, entries]) => entries.map(({ offset, label: text }) => ({ start: (anchor + offset) % 1440, label: text })));
  fc.assert(fc.property(schedule, (entries) => {
    // Rust UTF-8 string order agrees with byte order for valid Unicode scalars.
    // This oracle does not use the draft comparator or parseTime implementation.
    const source = entries.map((entry, index) => block(String(index), entry.start, 1, entry.label));
    const before = structuredClone(source);
    const expectedIds = entries.map((entry, index) => ({ ...entry, index, key: utf8SortKey(entry.label) }))
      .sort((a, b) => a.start - b.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || a.index - b.index)
      .map((entry) => String(entry.index));
    const normalized = normalizeDraftBlocks(source);
    expect(normalized.map((item) => item.id)).toEqual(expectedIds);
    expect(normalizeDraftBlocks(normalized)).toEqual(normalized);
    expect(source).toEqual(before);
  }), runs);
});

it('keeps identical start and label keys stable for every generated label', () => {
  fc.assert(fc.property(label, minute, fc.integer({ min: 2, max: 20 }), (text, start, count) => {
    const source = Array.from({ length: count }, (_, index) => block(String(index), start, 1, text));
    expect(normalizeDraftBlocks(source).map((item) => item.id)).toEqual(source.map((item) => item.id));
  }), runs);
});

it('isolates nested saved metadata across successful draft edits, creations and deletions', () => {
  fc.assert(fc.property(label, fc.array(label, { maxLength: 5 }), (text, links) => {
    const source = [block('edited', 540), block('retained', 600)];
    source[0].metadata.links = [...links];
    const before = structuredClone(source);
    const edited = applyDraftUpdate(source, 'edited', { label: text, project_id: 'new' });
    expect(edited.find((item) => item.id === 'edited')).toMatchObject({ label: text, metadata: { project_id: 'new', links } });
    (edited.find((item) => item.id === 'edited')!.metadata.links as string[]).push('draft edit');
    expect(source).toEqual(before);

    const added = block('new', 660, 1, text);
    const created = applyDraftCreate(source, added);
    expect(new Set(created.map((item) => item.id))).toEqual(new Set(['edited', 'retained', 'new']));
    for (const item of created) (item.metadata.links as string[]).push('draft create');
    expect(added.metadata.links).toEqual(['saved']);
    expect(source).toEqual(before);

    const deleted = applyDraftDelete(source, 'edited');
    expect(deleted.map((item) => item.id)).toEqual(['retained']);
    (deleted[0].metadata.links as string[]).push('draft delete');
    expect(source).toEqual(before);
  }), runs);
});

const cascade = fc.record({
  lengths: fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 8 }),
  movedLength: fc.integer({ min: 1, max: 120 }),
  cancelledLength: duration,
  slack: fc.integer({ min: 0, max: 60 }),
});

it('ripples all simultaneous live blocks in label order without consuming cancelled time', () => {
  fc.assert(fc.property(cascade, ({ lengths, movedLength, cancelledLength, slack }) => {
    const total = movedLength + lengths.reduce((sum, length) => sum + length, 0);
    const start = 1440 - total - slack;
    const cancelled = { ...block('cancelled', start, Math.min(cancelledLength, 1440 - start), '000'), status: 'cancelled' as const };
    const source = [block('moved', 0, movedLength), cancelled,
      ...lengths.map((length, index) => block(`live-${index}`, start, length))];
    const before = structuredClone(source);
    const result = applyDraftUpdate(source, 'moved', { start: time(start) });
    let expectedStart = start + movedLength;
    for (const [index, length] of lengths.entries()) {
      expect(result.find((item) => item.id === `live-${index}`)).toMatchObject({ start: time(expectedStart), duration: length });
      expectedStart += length;
    }
    expect(expectedStart).toBe(1440 - slack);
    expect(result.find((item) => item.id === 'cancelled')).toEqual(cancelled);
    expect(result.find((item) => item.id === 'moved')).toMatchObject({ start: time(start), duration: movedLength });
    expect(source).toEqual(before);
  }), runs);
});

it('allows generated cascades to end exactly at midnight', () => {
  fc.assert(fc.property(cascade, ({ lengths, movedLength }) => {
    const total = movedLength + lengths.reduce((sum, length) => sum + length, 0);
    const start = 1440 - total;
    const source = [block('moved', 0, movedLength), ...lengths.map((length, index) => block(`live-${index}`, start, length))];
    const result = applyDraftUpdate(source, 'moved', { start: time(start) });
    const last = result.find((item) => item.id === `live-${lengths.length - 1}`)!;
    expect(last.start).toBe(time(1440 - last.duration));
  }), runs);
});

it('rejects generated ripple overflows atomically, including metadata edited before validation', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 120 }), fc.integer({ min: 1, max: 120 }), (movedLength, liveLength) => {
    const start = 1440 - Math.max(movedLength, liveLength);
    const source = [block('moved', 0, movedLength), block('live', start, liveLength)];
    const before = structuredClone(source);
    expect(() => applyDraftUpdate(source, 'moved', { start: time(start), project_id: 'unsaved', label: 'unsaved' })).toThrow('24:00');
    expect(source).toEqual(before);
  }), runs);
});

it('moving a cancelled block leaves every live schedule unchanged', () => {
  fc.assert(fc.property(minute, fc.integer({ min: 1, max: 120 }), (start, length) => {
    const safeLength = Math.min(length, 1440 - start);
    const live = block('live', start, safeLength);
    const cancelled = { ...block('cancelled', 0, safeLength), status: 'cancelled' as const };
    const result = applyDraftUpdate([live, cancelled], 'cancelled', { start: time(start) });
    expect(result.find((item) => item.id === 'live')).toEqual(live);
  }), runs);
});

it('rejects out-of-range durations and noncanonical times without modifying input', () => {
  const invalidDuration = fc.oneof(fc.integer({ min: -1000, max: 0 }), fc.integer({ min: 481, max: 2000 }));
  const invalidStart = fc.oneof(
    fc.integer({ min: 0, max: 9 }).map((hour) => `${hour}:00`),
    fc.integer({ min: 60, max: 99 }).map((minutes) => `09:${minutes}`),
    fc.integer({ min: 24, max: 99 }).map((hour) => `${hour}:00`),
  );
  fc.assert(fc.property(invalidDuration, invalidStart, (length, start) => {
    const source = [block('saved', 540)];
    const before = structuredClone(source);
    expect(() => applyDraftUpdate(source, 'saved', { duration: length })).toThrow();
    expect(() => applyDraftUpdate(source, 'saved', { start })).toThrow();
    expect(() => applyDraftCreate(source, block('invalid', 0, length))).toThrow();
    expect(source).toEqual(before);
  }), runs);
});
