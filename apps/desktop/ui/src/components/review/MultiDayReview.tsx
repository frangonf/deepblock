import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getRangeReview } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatPlanDate } from '@/lib/utils';

export function MultiDayReview({ date }: { date: string }) {
  const initial = new Date(`${date}T12:00:00`);
  initial.setDate(initial.getDate() - 6);
  const first = `${initial.getFullYear()}-${String(initial.getMonth() + 1).padStart(2, '0')}-${String(initial.getDate()).padStart(2, '0')}`;
  const [start, setStart] = useState(first);
  const [end, setEnd] = useState(date);
  const [range, setRange] = useState({ start: first, end: date });
  const query = useQuery({ queryKey: ['plan', 'range-review', range.start, range.end], queryFn: () => getRangeReview(range.start, range.end) });
  const totals = query.data?.totals;
  return <Card><CardHeader><CardTitle>Multi-day review</CardTitle><CardDescription>One final saved plan per day. Feedback is voluntary; missing entries remain unknown.</CardDescription></CardHeader>
    <CardContent className="grid min-w-0 gap-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setRange({ start, end }); }}>
        <label className="grid gap-2 text-sm">Review start<Input aria-label="Review start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="grid gap-2 text-sm">Review end<Input aria-label="Review end" type="date" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <Button disabled={query.isFetching}>Review range</Button>
      </form>
      {query.isLoading && <p role="status">Loading multi-day review…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {totals && <div className="grid gap-2 text-sm" data-testid="range-review-totals">
        <p>{totals.planned_minutes} minutes planned · {totals.reported_minutes === null ? 'No reported minutes' : `${totals.reported_minutes} minutes reported`}</p>
        <p>{totals.minutes_reported_blocks} of {totals.eligible_blocks} blocks have reported minutes; {totals.focus_rated_blocks} have a self-rated focus score.</p>
        <p>Self-rated focus: {totals.focus_mean === null ? 'Not reported' : `${totals.focus_mean.toFixed(1)} / 5`} · Completion reported for {totals.completion_reported_blocks} blocks ({totals.completed_blocks} completed).</p>
      </div>}
      <div className="grid gap-2">{query.data?.days.map((day) => <details key={day.date} className="rounded-lg border border-line p-3 text-sm">
        <summary className="cursor-pointer">{formatPlanDate(day.date)} · {day.revision_id === null ? 'No saved plan' : `Revision ${day.revision_id}`} · {day.totals.planned_minutes} planned · {day.totals.reported_minutes === null ? 'No reported minutes' : `${day.totals.reported_minutes} reported`}</summary>
        <p className="mt-2 text-muted">Minutes coverage: {day.totals.minutes_reported_blocks}/{day.totals.eligible_blocks} blocks. Revision reasons: {day.revision_reasons.join('; ') || 'None recorded'}.</p>
      </details>)}</div>
      <p className="text-xs text-muted">Cancelled blocks are excluded. Breaks are included. Focus is the mean of recorded block ratings. These summaries do not measure attention or distraction.</p>
    </CardContent></Card>;
}
