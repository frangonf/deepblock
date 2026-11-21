import { useQuery } from '@tanstack/react-query';
import { getContext, type Block } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export function PlannerContext({ blocks, onUpdate, disabled }: { blocks: Block[]; onUpdate: (id: string, payload: Record<string, unknown>) => unknown; disabled: boolean }) {
  const catalog = useQuery({ queryKey: ['context'], queryFn: getContext });
  const [selected, setSelected] = useState('');
  const [open, setOpen] = useState(false);
  const block = blocks.find((b) => b.id === selected) ?? blocks[0];
  return <details className="rounded-xl border border-line p-4" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">Project and goal associations</summary>
    <p className="my-3 text-sm text-muted">Optional context for your plan. Changes join the draft and are committed with Save revised plan. <Link to="/settings">Manage projects and goals</Link>.</p>
    {catalog.isError && <p role="alert">Context unavailable. Your plan remains editable.</p>}
    {open && (block ? <div className="grid min-w-0 gap-3 sm:grid-cols-3">
      <label className="grid min-w-0 gap-2">Block<Select aria-label="Context block" value={block.id} onChange={(e) => setSelected(e.target.value)}>{blocks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</Select></label>
      <label className="grid min-w-0 gap-2">Project<Select aria-label="Block project" disabled={disabled || !catalog.data} value={typeof block.metadata.project_id === 'string' ? block.metadata.project_id : ''} onChange={(e) => onUpdate(block.id, { project_id: e.target.value || null })}><option value="">Unassigned</option>{catalog.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.ownership}</option>)}</Select></label>
      <label className="grid min-w-0 gap-2">Goal<Select aria-label="Block goal" disabled={disabled || !catalog.data} value={typeof block.metadata.goal_id === 'string' ? block.metadata.goal_id : ''} onChange={(e) => onUpdate(block.id, { goal_id: e.target.value || null })}><option value="">Unassigned</option>{catalog.data?.goals.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</Select></label>
    </div> : <p className="text-sm text-muted">Add a block to associate its intention.</p>)}
  </details>;
}
