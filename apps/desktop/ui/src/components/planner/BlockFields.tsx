import { useId, useState } from 'react';
import type { Block, BlockStatus, BlockType } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { statusOptions, typeOptions } from './shared';

type BlockFormValues = {
  label: string;
  start: string;
  duration: string;
  type: BlockType;
  status: BlockStatus;
  focusRating: string;
  nextAction: string;
  contentPath: string;
};

export type BlockFormInitialValues = Partial<Omit<BlockFormValues, 'duration' | 'focusRating'>> & {
  duration?: string | number;
  focusRating?: string | number;
};

export function useBlockForm(block: Block | null, initialValues?: BlockFormInitialValues) {
  const [values, setValues] = useState<BlockFormValues>(() => ({
    label: initialValues?.label ?? block?.label ?? '',
    start: initialValues?.start ?? block?.start ?? '09:00',
    duration: String(initialValues?.duration ?? block?.duration ?? 60),
    type: initialValues?.type ?? block?.type ?? 'focus',
    status: initialValues?.status ?? block?.status ?? 'proposed',
    focusRating: String(initialValues?.focusRating ?? block?.focus_rating ?? ''),
    nextAction: initialValues?.nextAction ?? block?.next_action ?? '',
    contentPath: initialValues?.contentPath ?? block?.content_path ?? '',
  }));
  const update = <K extends keyof BlockFormValues>(key: K, value: BlockFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  const payload = {
    label: values.label,
    start: values.start,
    duration: Number(values.duration),
    type: values.type,
    status: values.status,
    focus_rating: values.focusRating ? Number(values.focusRating) : null,
    next_action: values.nextAction || null,
    content_path: values.contentPath || null,
  };
  return { values, update, payload };
}

export function SelectField({ value, onChange, options, label }: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label: string;
}) {
  return <label className="grid min-w-0 gap-2 text-sm text-muted">
    <span>{label}</span>
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option} value={option} className="bg-canvas">{option.replace('_', ' ')}</option>)}
    </Select>
  </label>;
}

export function BlockFields({ form: { values, update }, compact = false }: {
  form: ReturnType<typeof useBlockForm>;
  compact?: boolean;
}) {
  const id = useId();
  const columns = compact ? 'block-fields__row grid min-w-0 gap-3' : 'block-fields__row grid min-w-0 gap-4';
  const status = <SelectField value={values.status} onChange={(value) => update('status', value as BlockStatus)} options={statusOptions} label="Status" />;
  const details = <>
    {compact && status}
    <div className={columns}>
      <label className="grid min-w-0 gap-2 text-sm text-muted">
        <span>Focus rating</span>
        {!compact && <small id={`${id}-focus`}>Optional · 1 (low) to 5 (high).</small>}
        <Input type="number" aria-label="Focus rating" min={1} max={5} aria-describedby={compact ? undefined : `${id}-focus`} value={values.focusRating} onChange={(event) => update('focusRating', event.target.value)} />
      </label>
      <label className="grid min-w-0 gap-2 text-sm text-muted">
        <span>Artifact path</span>
        {!compact && <small>Optional</small>}
        <Input aria-label="Artifact path" value={values.contentPath} onChange={(event) => update('contentPath', event.target.value)} />
      </label>
    </div>
    <label className="grid min-w-0 gap-2 text-sm text-muted">
      <span>Next action</span>
      {!compact && <small>Optional</small>}
      <Textarea aria-label="Next action" className={compact ? 'min-h-20' : undefined} value={values.nextAction} onChange={(event) => update('nextAction', event.target.value)} />
    </label>
  </>;
  return <>
    <label className="grid min-w-0 gap-2 text-sm text-muted">
      <span>Label</span>
      <Input required value={values.label} onChange={(event) => update('label', event.target.value)} />
    </label>
    <div className={columns}>
      <label className="grid min-w-0 gap-2 text-sm text-muted">
        <span>Start</span>
        <Input required type="time" value={values.start} onChange={(event) => update('start', event.target.value)} />
      </label>
      <label className="grid min-w-0 gap-2 text-sm text-muted">
        <span>Duration (minutes)</span>
        {!compact && <small id={`${id}-duration`}>15–480 minutes, ending by midnight.</small>}
        <Input required type="number" aria-label="Duration (minutes)" min={compact ? 5 : 15} max={480} aria-describedby={compact ? undefined : `${id}-duration`} value={values.duration} onChange={(event) => update('duration', event.target.value)} />
      </label>
    </div>
    <div className={columns}>
      <SelectField value={values.type} onChange={(value) => update('type', value as BlockType)} options={typeOptions} label="Type" />
      {!compact && status}
    </div>
    {compact ? <details className="border-t border-line">
      <summary className="cursor-pointer py-2 text-sm text-muted">Block details</summary>
      <div className="grid gap-3 pt-1">{details}</div>
    </details> : details}
  </>;
}
