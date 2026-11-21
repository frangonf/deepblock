import { DayNavigation } from '@/components/day-navigation';
import { useSelectedDate } from '@/hooks/use-selected-date';
import { describeBlockChanges } from '@/lib/comparison';
import { Select } from '@/components/ui/select';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { comparePlan } from '@/lib/api';
import { useDayPlan } from '@/hooks/use-day-plan';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ComparePage() {
  const [date, setDate] = useSelectedDate();
  const planQuery = useDayPlan(date);
  const revisions = planQuery.data?.revisions ?? [];
  const [selection, setSelection] = useState<{ date: string; base?: string; compare?: string }>({ date });
  const base = selection.date === date ? selection.base : undefined;
  const compare = selection.date === date ? selection.compare : undefined;
  const effectiveBase = revisions.find((revision) => revision.id === base)?.id ?? (revisions.find((revision) => revision.blocks.length > 0) ?? revisions[0])?.id;
  const effectiveCompare = revisions.find((revision) => revision.id === compare)?.id ?? revisions.at(-1)?.id;

  const comparisonQuery = useQuery({
    queryKey: ['compare', date, effectiveBase, effectiveCompare],
    queryFn: () => comparePlan(effectiveBase, effectiveCompare, date),
    enabled: revisions.length >= 2 && Boolean(effectiveBase && effectiveCompare) && effectiveBase !== effectiveCompare,
  });

  if (!planQuery.isLoading && !planQuery.error && revisions.length < 2) {
    return <div className="grid gap-6"><DayNavigation date={date} onChange={setDate} /><Card>
      <CardHeader><CardTitle>Nothing to compare yet</CardTitle><CardDescription>This day needs two saved revisions. Edit your plan and save a revised plan, then return here to see what changed.</CardDescription></CardHeader>
    </Card></div>;
  }

  return (
    <div className="grid gap-6">
      <DayNavigation date={date} onChange={setDate} />
      <Card>
        <CardHeader>
          <CardTitle>Choose revisions</CardTitle>
          <CardDescription>See how your plan changed between two revisions.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-muted">
            Base revision
            <Select

              value={effectiveBase}
              onChange={(event) => setSelection({ date, base: event.target.value, compare: effectiveCompare })}
            >
              {revisions.map((revision) => (
                <option key={revision.id} value={revision.id} className="bg-canvas">
                  {revision.id}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm text-muted">
            Compare revision
            <Select

              value={effectiveCompare}
              onChange={(event) => setSelection({ date, base: effectiveBase, compare: event.target.value })}
            >
              {revisions.map((revision) => (
                <option key={revision.id} value={revision.id} className="bg-canvas">
                  {revision.id}
                </option>
              ))}
            </Select>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle data-testid="compare-summary">{comparisonQuery.data?.summary ?? (comparisonQuery.error ? 'Could not compare these revisions' : planQuery.error ? 'Could not load this day' : comparisonQuery.isLoading || planQuery.isLoading ? 'Loading comparison…' : effectiveBase === effectiveCompare ? 'Choose two different revisions' : 'No revisions to compare')}</CardTitle>
          <CardDescription>Added, removed, and modified blocks are grouped below with field-level details.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          {[
            { label: 'Added', items: comparisonQuery.data?.added ?? [], tone: 'text-success' },
            { label: 'Removed', items: comparisonQuery.data?.removed ?? [], tone: 'text-danger' },
            { label: 'Modified', items: comparisonQuery.data?.modified ?? [], tone: 'text-warning' },
          ].map(({ label, items, tone }) => (
            <div key={label} className="rounded-[var(--db-radius)] border border-line bg-raised p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className={`font-medium ${tone}`}>{label}</h3>
                <Badge>{items.length}</Badge>
              </div>
              <div className="grid gap-3">
                {items.length === 0 ? (
                  <div className="text-sm text-muted">No changes.</div>
                ) : (
                  items.map((item) => (
                    <div key={item.block_id} className="rounded-[var(--db-radius)] border border-line p-3 text-sm">
                      <div className="font-medium text-ink">{item.label}</div>
                      <ul className="mt-2 grid gap-1 text-sm text-muted">{describeBlockChanges(item.details).map((detail) => <li key={detail}>{detail}</li>)}</ul>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
