import { useState } from 'react';
import { useConfig } from '@/hooks/use-config';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { Clock3, Globe2, Laptop2, RefreshCcw } from 'lucide-react';

import { getActivityWatchSummary, type ActivityWatchRankedItem } from '@/lib/api';
import { formatMinutes } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function formatDurationSeconds(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return formatMinutes(Math.round(seconds / 60));
}

function formatTimestamp(value: string, timeFormat: '12h' | '24h') {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  });
}

function statusTone(status: string) {
  if (status === 'not-afk') {
    return 'status-success';
  }
  if (status === 'afk') {
    return 'status-warning';
  }
  return 'border-line bg-raised text-muted';
}

function RankedList({
  title,
  description,
  items,
  emptyLabel,
}: {
  title: string;
  description: string;
  items: ActivityWatchRankedItem[];
  emptyLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-[var(--db-radius)] border border-dashed border-line bg-raised p-4 text-sm text-muted">{emptyLabel}</div>
        ) : (
          items.map((item) => (
            <div key={item.label} className="space-y-2 rounded-[var(--db-radius)] border border-line bg-raised p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{item.label}</div>
                  {item.detail ? <div className="truncate text-xs text-muted">{item.detail}</div> : null}
                </div>
                <div className="shrink-0 text-xs text-muted">{formatDurationSeconds(item.duration_seconds)}</div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-raised">
                <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(item.percent, 4)}%` }} />
              </div>
              <div className="text-xs text-muted">{item.percent}% of active tracked time</div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function ActivityWatchPage({ available }: { available: boolean }) {
  const [filter, setFilter] = useState('');
  const configQuery = useConfig();
  const timestamp = (value: string) => formatTimestamp(value, configQuery.data?.time_format ?? '24h');
  const summaryQuery = useQuery({
    queryKey: ['activitywatch', 'summary'],
    queryFn: getActivityWatchSummary,
    enabled: available,
  });

  if (!available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Today · live snapshot</CardTitle>
          <CardDescription>This panel only appears when a local ActivityWatch runtime is available.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted">
          DeepBlock hides the explorer and skips ActivityWatch API reads until the ActivityWatch server becomes reachable.
        </CardContent>
      </Card>
    );
  }

  if (summaryQuery.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted">Loading ActivityWatch context…</CardContent>
      </Card>
    );
  }

  if (summaryQuery.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Today · live snapshot</CardTitle>
          <CardDescription>The ActivityWatch snapshot could not be loaded right now.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-danger">{summaryQuery.error.message}</CardContent>
      </Card>
    );
  }

  const summary = summaryQuery.data;
  if (!summary) {
    return null;
  }

  const recentWindows = summary.today.recent_windows.filter((event) => `${event.app ?? ''} ${event.title ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Today · live snapshot</CardTitle>
          <CardDescription>
            Local activity snapshot from ActivityWatch on {summary.hostname} running {summary.server_version}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted">
            This page always shows today and your latest local activity, regardless of the plan date selected elsewhere.
          </div>
          <Button variant="secondary" onClick={() => void summaryQuery.refetch()} disabled={summaryQuery.isFetching}>
            <RefreshCcw className="h-4 w-4" />
            Refresh snapshot
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex h-full flex-col justify-between gap-2 p-5">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Clock3 className="h-4 w-4" />
              Active today
            </div>
            <div className="text-2xl font-semibold text-ink">{formatDurationSeconds(summary.today.active_seconds)}</div>
            <div className="text-xs text-muted">Derived from not-AFK periods when available.</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full flex-col justify-between gap-2 p-5">
            <div className="text-sm text-muted">Current status</div>
            <div className={`inline-flex w-fit rounded-full border px-3 py-1 text-sm ${statusTone(summary.current_status)}`}>
              {summary.current_status}
            </div>
            <div className="text-xs text-muted">
              {summary.current_window ? `Last window at ${timestamp(summary.current_window.timestamp)}` : 'No current window sample yet.'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full flex-col justify-between gap-2 p-5">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Laptop2 className="h-4 w-4" />
              Current app
            </div>
            <div className="text-lg font-semibold text-ink">{summary.current_window?.app ?? 'Unavailable'}</div>
            <div className="line-clamp-2 text-xs text-muted">
              {summary.current_window?.title ?? 'No active window watcher data is available yet.'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex h-full flex-col justify-between gap-2 p-5">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Globe2 className="h-4 w-4" />
              Current tab
            </div>
            <div className="text-lg font-semibold text-ink">{summary.current_web_tab?.domain ?? 'Unavailable'}</div>
            <div className="line-clamp-2 text-xs text-muted">
              {summary.current_web_tab?.title ?? 'No browser watcher data is available for the current snapshot.'}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <RankedList
          title="Top apps today"
          description="Active window time after AFK filtering when the AFK watcher is present."
          items={summary.today.top_apps}
          emptyLabel="No app activity has been recorded for today yet."
        />
        <RankedList
          title="Top sites today"
          description="Browser domains from the ActivityWatch web watcher when that bucket exists."
          items={summary.today.top_domains}
          emptyLabel="No browser activity bucket was available for the current machine."
        />
      </div>

      <details className="rounded-[var(--db-radius)] border border-line bg-surface">
        <summary className="cursor-pointer p-5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Recent active windows ({summary.today.recent_windows.length})</summary>
        <div className="space-y-3 p-5 pt-0">
          <label className="grid gap-2 text-sm text-muted">Filter by app or window title<Input value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
          {recentWindows.length === 0 && summary.today.recent_windows.length > 0 ? <p className="text-sm text-muted">No windows match this filter.</p> : null}
          {summary.today.recent_windows.length === 0 ? (
            <div className="rounded-[var(--db-radius)] border border-dashed border-line bg-raised p-4 text-sm text-muted">
              No recent active window data is available yet.
            </div>
          ) : (
            recentWindows.map((event, index) => (
              <div key={`${event.timestamp}-${index}`} className="flex flex-col gap-2 rounded-[var(--db-radius)] border border-line bg-raised p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{event.app ?? 'Unknown app'}</div>
                  <div className="truncate text-xs text-muted">{event.title ?? 'Untitled window'}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <div className="rounded-full border border-line bg-raised px-3 py-1">{timestamp(event.timestamp)}</div>
                  <div className="rounded-full border border-line bg-raised px-3 py-1">{formatDurationSeconds(event.duration_seconds)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </details>

      <Card>
        <CardHeader>
          <CardTitle>Watcher health</CardTitle>
          <CardDescription>The ActivityWatch buckets DeepBlock is currently reading from this machine.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {summary.watchers.map((watcher) => (
            <div key={watcher.bucket_id} className="rounded-[var(--db-radius)] border border-line bg-raised p-4 text-sm">
              <div className="font-medium capitalize text-ink">{watcher.kind} watcher</div>
              <div className="mt-1 text-muted">{watcher.client}</div>
              <div className="mt-3 text-xs text-muted">{watcher.bucket_id}</div>
              <div className="mt-2 text-xs text-muted">
                {watcher.event_type}
                {watcher.last_updated ? ` · last update ${timestamp(watcher.last_updated)}` : ''}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
