import { IntentHistory } from '@/components/review/IntentHistory';
import { ReviewOutcomes } from '@/components/review/ReviewOutcomes';
import { MultiDayReview } from '@/components/review/MultiDayReview';
import { formatPlanDate } from '@/lib/utils';
import { DayNavigation } from '@/components/day-navigation';
import { useSelectedDate } from '@/hooks/use-selected-date';
import { useQuery } from '@tanstack/react-query';
import { FileCheck2, AlertCircle, AlertTriangle, Info } from 'lucide-react';

import { getPlanReview, type VarianceReport, type VarianceSeverity } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function severityIcon(severity: VarianceSeverity) {
  switch (severity) {
    case 'high':
      return <AlertCircle className="h-5 w-5 text-danger" />;
    case 'medium':
      return <AlertTriangle className="h-5 w-5 text-warning" />;
    case 'low':
      return <Info className="h-5 w-5 text-accent" />;
  }
}

function severityTone(severity: VarianceSeverity) {
  switch (severity) {
    case 'high':
      return 'status-danger';
    case 'medium':
      return 'status-warning';
    case 'low':
      return 'status-info';
  }
}

function formatVarianceType(type: string) {
  return type.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function renderReportData(report: VarianceReport) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {Object.entries(report.data).map(([key, value]) => (
        <div key={key} className="rounded-full border border-line bg-raised px-3 py-1 text-xs text-muted">
          {key.replace(/_/g, ' ')}: {String(value)}
        </div>
      ))}
    </div>
  );
}

export function ReviewPage() {
  const [date, setDate] = useSelectedDate();
  const reviewQuery = useQuery({ queryKey: ['plan', 'review', date], queryFn: () => getPlanReview(date) });

  if (reviewQuery.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted">Loading plan review…</CardContent>
      </Card>
    );
  }

  if (reviewQuery.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Evidence coverage</CardTitle>
          <CardDescription>Could not load the plan review.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-danger">{reviewQuery.error.message}</CardContent>
      </Card>
    );
  }

  const review = reviewQuery.data;
  if (!review) return null;

  const observed = review.summary.observed_blocks;
  const coverageKnown = observed !== undefined;
  const noEvidence = coverageKnown ? observed === 0 || review.summary.reviewed_blocks === 0 : review.summary.reviewed_blocks === 0;
  const partial = coverageKnown ? observed < review.summary.reviewed_blocks : review.summary.reviewed_blocks > 0;

  return (
    <div className="grid gap-6">
      <DayNavigation date={date} onChange={setDate} />
      <Card>
        <CardHeader>
          <CardTitle>Evidence coverage</CardTitle>
          <CardDescription>
            Review for {formatPlanDate(review.date)} (Revision {review.revision_id}).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-6">
          <p className="w-full text-sm text-muted" data-testid="review-coverage">
            {coverageKnown ? `${observed} of ${review.summary.reviewed_blocks} blocks have recorded duration or focus evidence.` : 'Evidence coverage is unavailable from this server.'}
            {' '}Findings use self-reported duration/focus and local computer activity. ActivityWatch category mix is not task duration or measured attention quality.
          </p>
          <div className="flex flex-col">
            <span className="text-2xl font-semibold text-ink">{review.summary.reviewed_blocks}</span>
            <span className="text-xs text-muted">Planned blocks</span>
          </div>
          <div className="flex gap-4">
            <div className="flex flex-col items-center justify-center rounded-[var(--db-radius)] bg-danger/10 p-3 px-4">
              <span className="text-xl font-medium text-danger">{noEvidence || (!coverageKnown && review.summary.total_reports === 0) ? 'Not assessed' : review.summary.high}</span>
              <span className="text-xs text-danger">High variance</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded-[var(--db-radius)] bg-warning/10 p-3 px-4">
              <span className="text-xl font-medium text-warning">{noEvidence || (!coverageKnown && review.summary.total_reports === 0) ? 'Not assessed' : review.summary.medium}</span>
              <span className="text-xs text-warning">Med variance</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded-[var(--db-radius)] bg-accent/10 p-3 px-4">
              <span className="text-xl font-medium text-accent">{noEvidence || (!coverageKnown && review.summary.total_reports === 0) ? 'Not assessed' : review.summary.low}</span>
              <span className="text-xs text-accent">Low variance</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <IntentHistory key={`intent-${date}`} date={date} />
      <ReviewOutcomes key={date} date={date} />
      <MultiDayReview key={`range-${date}`} date={date} />
      <div className="grid gap-4">
        {review.reports.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center text-muted">
              <FileCheck2 className="h-10 w-10 text-muted" />
              <div>
                <div className="text-base font-medium text-muted">{noEvidence ? 'No recorded evidence yet' : !coverageKnown ? 'Evidence coverage unavailable' : partial ? 'Review is incomplete' : 'No discrepancies reported'}</div>
                <div className="text-sm">{noEvidence ? 'Record a duration or focus rating, or run today’s activity audit to start your review.' : !coverageKnown ? 'This server does not report evidence coverage, so an empty findings list cannot establish whether the day was reviewed.' : partial ? 'No discrepancies were reported for the available evidence. Blocks without evidence remain unassessed.' : 'Available evidence is within the review thresholds. This does not confirm that every block went as planned.'}</div>
              </div>
            </CardContent>
          </Card>
        ) : (
          review.reports.map((report, index) => (
            <Card key={`${report.block_id}-${index}`}>
              <CardContent className="flex flex-col gap-4 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{report.block_label}</CardTitle>
                      {severityIcon(report.severity)}
                    </div>
                    <CardDescription className="mt-1">
                      {report.variance_type === 'focus_mismatch' && report.data.focus_source === 'activitywatch' ? 'Activity category mix' : formatVarianceType(report.variance_type)}
                    </CardDescription>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${severityTone(report.severity)}`}>
                    {report.severity}
                  </div>
                </div>

                <div className="text-sm text-muted">
                  {report.suggestion}
                </div>

                {renderReportData(report)}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
