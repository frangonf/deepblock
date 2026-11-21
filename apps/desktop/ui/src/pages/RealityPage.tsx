import { useSelectedDate } from '@/hooks/use-selected-date';
import { DayNavigation } from '@/components/day-navigation';
import { todayString } from '@/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, BrainCircuit, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';

import { auditPlan } from '@/lib/api';
import { useDayPlan } from '@/hooks/use-day-plan';
import { formatMinutes, getScoreTone, parseTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function formatBlockTypeLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function RealityPage() {
  const queryClient = useQueryClient();
  const [date, setDate] = useSelectedDate();
  const planQuery = useDayPlan(date);
  const auditMutation = useMutation({
    mutationFn: auditPlan,
    onSuccess: async () => {
      toast.success('Reality data updated');
      await queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const allBlocks = (planQuery.data?.revisions.at(-1)?.blocks ?? []).filter((block) => block.status !== 'cancelled');
  const blocks = allBlocks.filter((block) => (block.reality?.total_active_seconds ?? 0) > 0);
  const pendingBlocks = allBlocks.filter((block) => (block.reality?.total_active_seconds ?? 0) === 0);
  const averageFocusScore =
    blocks.length === 0 ? null : Math.round(blocks.reduce((total, block) => total + block.reality!.focus_score, 0) / blocks.length);
  const currentMinutes = parseTime(new Date().toTimeString().slice(0, 5));
  const hasPastBlocks = date < todayString() || (date === todayString() && allBlocks.some((block) => parseTime(block.start) + block.duration <= currentMinutes));

  return (
    <div className="grid gap-6">
      <DayNavigation date={date} onChange={setDate} />
      <Card>
        <CardHeader>
          <CardTitle>Activity audit</CardTitle>
          <CardDescription>Review computer activity captured within planned windows. Category match is not a measure of attention or task duration.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 text-sm text-muted">
            <div>Audits use local ActivityWatch data for today. Other dates show saved results.</div>
            <div>
              {blocks.length} of {allBlocks.length} block(s) audited
              {averageFocusScore !== null ? ` · avg category match ${averageFocusScore}%` : ''}
            </div>
          </div>
          <Button onClick={() => auditMutation.mutate()} disabled={date !== todayString() || auditMutation.isPending} title={date !== todayString() ? "Audits are available for today only" : undefined}>
            <RefreshCcw className="h-4 w-4" />
            Run audit
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {blocks.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted">
              {date < todayString() ? 'No activity audit was saved for this day.' : hasPastBlocks ? 'No reality data yet. Run an audit after you have completed some blocks.' : 'No completed blocks are ready for audit yet.'}
            </CardContent>
          </Card>
        ) : (
          blocks.map((block) => (
            <Card key={block.id}>
              <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{block.label}</CardTitle>
                    <BadgeCheck className="h-4 w-4 text-success" />
                  </div>
                  <CardDescription>
                    Planned {block.start} · {block.duration} minutes · {block.type}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className={`rounded-full border px-3 py-1 text-sm ${getScoreTone(block.reality!.focus_score)}`}>
                    Category match {block.reality!.focus_score}%
                  </div>
                  <div className="rounded-full border border-line bg-raised px-3 py-1 text-sm text-muted">
                    Top app {block.reality!.top_app}
                  </div>
                  <div className="rounded-full border border-line bg-raised px-3 py-1 text-sm text-muted">
                    <BrainCircuit className="mr-2 inline h-4 w-4" />
                    {formatMinutes(Math.round(block.reality!.total_active_seconds / 60))} computer-active
                  </div>
                </div>
                {Object.keys(block.reality!.category_breakdown).length > 0 ? (
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {Object.entries(block.reality!.category_breakdown).map(([category, seconds]) => (
                      <div key={category} className="rounded-full border border-line bg-raised px-3 py-1 text-xs text-muted">
                        {category} · {formatMinutes(Math.round(seconds / 60))}
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {pendingBlocks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending audit</CardTitle>
            <CardDescription>Blocks without ActivityWatch data yet.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pendingBlocks.map((block) => (
              <div key={block.id} className="rounded-[var(--db-radius)] border border-line bg-raised p-4 text-sm text-muted">
                  <div className="font-medium text-ink">{block.label}</div>
                  <div className="mt-1 text-muted">
                    {block.start} · {formatMinutes(block.duration)} · {formatBlockTypeLabel(block.type)}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
