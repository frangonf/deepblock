import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import * as api from '@/lib/api';
import { ReviewPage } from './ReviewPage';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    getPlanReview: vi.fn(),
    getPlan: vi.fn(),
    getRangeReview: vi.fn(),
    getIntentHistory: vi.fn(),
  };
});

vi.mock('@/lib/dataset', () => ({ensureDataset: async () => 'test-generation', assertDataset: () => {}, retireDataset: () => {}, checkDataset: async () => {}}));

describe('ReviewPage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
    vi.mocked(api.getIntentHistory).mockResolvedValue([]);
    vi.mocked(api.getRangeReview).mockResolvedValue({ start: '2026-07-20', end: '2026-07-26', baseline: 'final_active_revision', days: [], totals: { planned_minutes: 0, reported_minutes: null, eligible_blocks: 0, minutes_reported_blocks: 0, focus_rated_blocks: 0, focus_mean: null, completion_reported_blocks: 0, completed_blocks: 0 } });
    vi.mocked(api.getPlan).mockResolvedValue({ schema_version: 1, date: '2026-07-26', revisions: [], note_path: null, change_log: [] });
  });

  afterEach(() => vi.unstubAllGlobals());
  const outcomePlan: api.DayPlan = { schema_version: 1, date: '2026-07-26', note_path: null, change_log: [], revisions: [{ id: 'B', created_at: '', reason: null, blocks: [{ id: 'work', label: 'Work', start: '09:00', duration: 60, type: 'focus', status: 'proposed', created_at: '', metadata: {}, content_path: null, next_action: null, actual_duration: null, focus_rating: null, artifacts: [], reality: null }] }] };
  const emptyReview: api.PlanReviewResponse = { date: '2026-07-26', revision_id: 'B', summary: { reviewed_blocks: 1, observed_blocks: 0, total_reports: 0, high: 0, medium: 0, low: 0 }, reports: [] };

  const renderPage = () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/review?date=2026-07-26']}><ReviewPage /></MemoryRouter>
      </QueryClientProvider>
    );
  };

  it('records optional outcomes for the selected historical day without sending scheduling fields', async () => {
    vi.mocked(api.getPlan).mockResolvedValue(outcomePlan);
    vi.mocked(api.getPlanReview).mockResolvedValue(emptyReview);
    const fetch = vi.fn(async () => new Response(JSON.stringify(outcomePlan), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Record outcome for Work' }));
    fireEvent.change(screen.getByLabelText('Actual minutes'), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText('Focus rating'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Completion'), { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save outcome' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/blocks/work/outcome?date=2026-07-26');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ actual_duration: 95, focus_rating: 3, completed: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('omits unchanged outcome fields so concurrent feedback is not overwritten', async () => {
    const initial = structuredClone(outcomePlan);
    initial.revisions[0].blocks[0].focus_rating = 2;
    initial.revisions[0].blocks[0].metadata.outcome_completed = true;
    vi.mocked(api.getPlan).mockResolvedValue(initial);
    vi.mocked(api.getPlanReview).mockResolvedValue(emptyReview);
    const latest = structuredClone(initial);
    Object.assign(latest.revisions[0].blocks[0], { actual_duration: 95, focus_rating: 4 });
    latest.revisions[0].blocks[0].metadata.outcome_completed = false;
    const fetch = vi.fn(async () => new Response(JSON.stringify(latest), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Record outcome for Work' }));
    fireEvent.change(screen.getByLabelText('Actual minutes'), { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save outcome' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ actual_duration: 95 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('retains the outcome form when saving fails', async () => {
    vi.mocked(api.getPlan).mockResolvedValue(outcomePlan);
    vi.mocked(api.getPlanReview).mockResolvedValue(emptyReview);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Write failed' }), { status: 500 })));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Record outcome for Work' }));
    fireEvent.change(screen.getByLabelText('Actual minutes'), { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save outcome' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write failed');
    expect(screen.getByLabelText('Actual minutes')).toHaveValue(95);
  });

  it('shows loading state initially', () => {
    // Return a never-resolving promise so it stays in loading state
    vi.mocked(api.getPlanReview).mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading plan review…')).toBeInTheDocument();
  });

  it('shows error state if API fails', async () => {
    vi.mocked(api.getPlanReview).mockRejectedValue(new Error('Failed to fetch review'));

    renderPage();

    expect(await screen.findByText('Could not load the plan review.')).toBeInTheDocument();
    expect(await screen.findByText('Failed to fetch review')).toBeInTheDocument();
  });

  it('shows empty state when there are no variances', async () => {
    vi.mocked(api.getPlanReview).mockResolvedValue({
      date: '2026-07-26',
      revision_id: 'A',
      summary: {
        reviewed_blocks: 5,
        observed_blocks: 5,
        total_reports: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      reports: [],
    });

    renderPage();

    expect(await screen.findByText('No discrepancies reported')).toBeInTheDocument();
    expect(screen.getByText('Available evidence is within the review thresholds. This does not confirm that every block went as planned.')).toBeInTheDocument();
  });

  it('does not treat a response without coverage metadata as a complete review', async () => {
    vi.mocked(api.getPlanReview).mockResolvedValue({ date: '2026-07-26', revision_id: 'A',
      summary: { reviewed_blocks: 5, total_reports: 0, high: 0, medium: 0, low: 0 }, reports: [] });
    renderPage();
    expect(await screen.findByText('Evidence coverage unavailable')).toBeInTheDocument();
    expect(screen.getByText(/cannot establish whether the day was reviewed/)).toBeInTheDocument();
  });

  it.each([
    [0, 'No recorded evidence yet'],
    [2, 'Review is incomplete'],
  ])('does not claim success with %s observed blocks', async (observed, heading) => {
    vi.mocked(api.getPlanReview).mockResolvedValue({ date: '2026-07-26', revision_id: 'A',
      summary: { reviewed_blocks: 5, observed_blocks: observed, total_reports: 0, high: 0, medium: 0, low: 0 }, reports: [] });
    renderPage();
    expect(await screen.findByText(heading)).toBeInTheDocument();
    expect(screen.getByTestId('review-coverage')).toHaveTextContent(`${observed} of 5 blocks`);
    expect(api.getPlanReview).toHaveBeenCalledWith('2026-07-26');
    expect(screen.queryByText('The active plan is executing exactly as estimated.')).not.toBeInTheDocument();
  });

  it('renders variance reports correctly', async () => {
    vi.mocked(api.getPlanReview).mockResolvedValue({
      date: '2026-07-26',
      revision_id: 'B',
      summary: {
        reviewed_blocks: 4,
        total_reports: 2,
        high: 1,
        medium: 1,
        low: 0,
      },
      reports: [
        {
          block_id: 'block-1',
          block_label: 'Deep Work Session',
          variance_type: 'duration_mismatch',
          severity: 'high',
          suggestion: 'Try breaking this down into smaller chunks.',
          data: {
            planned_duration: 60,
            observed_duration: 120,
            variance_minutes: 60
          },
        },
        {
          block_id: 'block-2',
          block_label: 'Quick sync',
          variance_type: 'overrun',
          severity: 'medium',
          suggestion: 'Check if this meeting is actually needed.',
          data: {
            overrun_minutes: 15
          },
        }
      ],
    });

    renderPage();

    // Check header
    expect(await screen.findByText(/Review for 26 July 2026/)).toBeInTheDocument();

    // Check summary numbers
    expect(screen.getByText('4')).toBeInTheDocument(); // reviewed blocks

    // Check first report
    expect(screen.getByText('Deep Work Session')).toBeInTheDocument();
    expect(screen.getByText('Duration Mismatch')).toBeInTheDocument();
    expect(screen.getByText('Try breaking this down into smaller chunks.')).toBeInTheDocument();
    expect(screen.getByText('planned duration: 60')).toBeInTheDocument();
    expect(screen.getByText('observed duration: 120')).toBeInTheDocument();

    // Check second report
    expect(screen.getByText('Quick sync')).toBeInTheDocument();
    expect(screen.getByText('Overrun')).toBeInTheDocument();
    expect(screen.getByText('Check if this meeting is actually needed.')).toBeInTheDocument();
    expect(screen.getByText('overrun minutes: 15')).toBeInTheDocument();
  });
});
