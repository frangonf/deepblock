import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveBlockOutcome, type Block, type BlockOutcome } from '@/lib/api';
import { useDayPlan } from '@/hooks/use-day-plan';
import { formatMinutes, todayString } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

function completion(block: Block): boolean | null {
  return typeof block.metadata.outcome_completed === 'boolean' ? block.metadata.outcome_completed : block.status === 'done' ? true : null;
}

function OutcomeForm({ block, date, onClose }: { block: Block; date: string; onClose: () => void }) {
  const client = useQueryClient();
  const [minutes, setMinutes] = useState(String(block.actual_duration ?? ''));
  const [rating, setRating] = useState(String(block.focus_rating ?? ''));
  const [completed, setCompleted] = useState(String(completion(block) ?? ''));
  const save = useMutation({
    mutationFn: (payload: BlockOutcome) => saveBlockOutcome(block.id, payload, date),
    onSuccess: async (plan) => {
      client.setQueryData(['plan', date], plan);
      onClose();
      await client.invalidateQueries({ queryKey: ['plan'] });
      await client.invalidateQueries({ queryKey: ['compare'] });
    },
  });
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Outcome for {block.label}</DialogTitle>
        <DialogDescription>Optional self-reported feedback. This does not reschedule the block or create a plan revision. Blank fields clear previously recorded values.</DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" onSubmit={(event) => {
        event.preventDefault();
        const payload: BlockOutcome = {};
        const actual = minutes === '' ? null : Number(minutes);
        const focus = rating === '' ? null : Number(rating);
        const done = completed === '' ? null : completed === 'true';
        // The form holds an opening snapshot. Omit unedited fields so a
        // concurrent client's feedback survives; explicit blanks still clear.
        if (actual !== (block.actual_duration ?? null)) payload.actual_duration = actual;
        if (focus !== (block.focus_rating ?? null)) payload.focus_rating = focus;
        if (done !== completion(block)) payload.completed = done;
        save.mutate(payload);
      }}>
        <label className="grid gap-1 text-sm text-muted"><span>Actual minutes</span>
          <Input type="number" min={0} max={1440} step={1} value={minutes} disabled={save.isPending} onChange={(event) => setMinutes(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-muted"><span>Focus rating</span>
          <Input aria-label="Focus rating" aria-describedby="outcome-focus-help" type="number" min={1} max={5} step={1} value={rating} disabled={save.isPending} onChange={(event) => setRating(event.target.value)} />
          <small id="outcome-focus-help">1 (low) to 5 (high), based on your own experience.</small>
        </label>
        <label className="grid gap-1 text-sm text-muted"><span>Completion</span>
          <Select aria-label="Completion" value={completed} disabled={save.isPending} onChange={(event) => setCompleted(event.target.value)}>
            <option value="">Not recorded</option><option value="true">Completed</option><option value="false">Not completed</option>
          </Select>
        </label>
        {save.error && <p role="alert" className="text-sm text-danger">{save.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save outcome'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function ReviewOutcomes({ date }: { date: string }) {
  const plan = useDayPlan(date);
  const [selected, setSelected] = useState<Block | null>(null);
  const blocks = plan.data?.revisions.at(-1)?.blocks.filter((block) => block.status !== 'cancelled') ?? [];
  return <Card>
    <CardHeader><CardTitle>Record outcomes</CardTitle>
      <CardDescription>Optional feedback for this day, including next-day reflection. Historical scheduling intent stays unchanged. Completion alone does not establish duration or focus coverage.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-3">
      {plan.isLoading ? <p className="text-sm text-muted">Loading blocks…</p> : plan.error ? <p role="alert" className="text-sm text-danger">Could not load blocks: {plan.error.message}</p> : blocks.length === 0 ? <p className="text-sm text-muted">No planned blocks to reflect on.</p> : blocks.map((block) => <div key={block.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--db-radius)] border border-line p-3">
        <div><p className="font-medium text-ink">{block.label}</p>
          <p className="text-sm text-muted">Planned {block.start} · {formatMinutes(block.duration)}</p>
          <p className="text-sm text-muted">{block.actual_duration == null ? 'Actual minutes not recorded' : `Actual ${formatMinutes(block.actual_duration)}`} · {block.focus_rating == null ? 'Focus not rated' : `Self-rated focus ${block.focus_rating}/5`} · {completion(block) == null ? 'Completion not recorded' : completion(block) ? 'Completed' : 'Not completed'}</p>
        </div>
        <Button size="sm" variant="outline" aria-label={`Record outcome for ${block.label}`} disabled={date > todayString()} onClick={() => setSelected(block)}>Record outcome</Button>
      </div>)}
      {date > todayString() && <p className="text-sm text-muted">Outcomes are available for today and past days.</p>}
      {selected && <OutcomeForm key={selected.id} date={date} block={selected} onClose={() => setSelected(null)} />}
    </CardContent>
  </Card>;
}
