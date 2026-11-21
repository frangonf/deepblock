import { assertDataset, ensureDataset, retireDataset, checkDataset } from '@/lib/dataset';
import { invokeTauriCommand, isTauriRuntime, resolveBrowserApiBaseUrl } from '@/lib/runtime';

export type BlockType = 'focus' | 'shallow' | 'urgent' | 'break';
export type BlockStatus = 'proposed' | 'confirmed' | 'cancelled' | 'done';
export type RevisionCopyMode = 'all' | 'from_now' | 'empty';
export type InteractionMode = 'focus' | 'reflect';
export type BacklogStatus = 'todo' | 'inprogress' | 'done';
export type ModulesResponse = { api_version: number; modules: Array<{ module_id: string; state: string; provider_id: string | null; failures: number; queued: number }> };
export function getModules(): Promise<ModulesResponse> { return apiFetch('/modules'); }
export type ReviewTotals = {
  planned_minutes: number; reported_minutes: number | null; eligible_blocks: number;
  minutes_reported_blocks: number; focus_rated_blocks: number; focus_mean: number | null;
  completion_reported_blocks: number; completed_blocks: number;
};
export type RangeReview = {
  start: string; end: string; baseline: 'final_active_revision'; totals: ReviewTotals;
  days: Array<{ date: string; revision_id: string | null; totals: ReviewTotals; revision_reasons: string[] }>;
};
export function getRangeReview(start: string, end: string): Promise<RangeReview> {
  return apiFetch(`/review/range?${new URLSearchParams({ start, end })}`);
}
export type Project = { id: string; name: string; ownership: 'personal' | 'employer' | 'client' };
export type Goal = { id: string; label: string };
export type ContextCatalog = { schema_version: number; projects: Project[]; goals: Goal[] };

export function getContext(): Promise<ContextCatalog> { return apiFetch('/context'); }
export function saveContext(base: ContextCatalog, catalog: ContextCatalog): Promise<ContextCatalog> {
  return apiFetch('/context', { method: 'PUT', body: JSON.stringify({ base, catalog }) });
}

export type RealityLog = {
  total_active_seconds: number;
  focus_score: number;
  top_app: string;
  category_breakdown: Record<string, number>;
};

export type Block = {
  id: string;
  label: string;
  start: string;
  duration: number;
  type: BlockType;
  status: BlockStatus;
  created_at: string;
  metadata: Record<string, unknown>;
  content_path: string | null;
  focus_rating: number | null;
  actual_duration: number | null;
  next_action: string | null;
  artifacts: string[];
  reality: RealityLog | null;
};

export type Revision = {
  id: string;
  created_at: string;
  reason: string | null;
  blocks: Block[];
};

export type DayPlan = {
  schema_version: number;
  date: string;
  revisions: Revision[];
  note_path: string | null;
  change_log: Array<Record<string, unknown>>;
};

export type BlockDiff = {
  block_id: string;
  label: string;
  change_type: 'added' | 'removed' | 'modified';
  details: Record<string, unknown>;
};

export type PlanComparison = {
  base_revision: string;
  compare_revision: string;
  added: BlockDiff[];
  removed: BlockDiff[];
  modified: BlockDiff[];
  change_log: Array<Record<string, unknown>>;
  summary: string;
};

export type VarianceType = 'duration_mismatch' | 'focus_mismatch' | 'start_time_drift' | 'overrun';

export type VarianceSeverity = 'low' | 'medium' | 'high';

export type VarianceReport = {
  block_id: string;
  block_label: string;
  variance_type: VarianceType;
  severity: VarianceSeverity;
  suggestion: string;
  data: Record<string, unknown>;
};

export type PlanReviewSummary = {
  reviewed_blocks: number;
  observed_blocks?: number;
  total_reports: number;
  high: number;
  medium: number;
  low: number;
};

export type PlanReviewResponse = {
  date: string;
  revision_id: string;
  summary: PlanReviewSummary;
  reports: VarianceReport[];
};


export type BacklogItem = {
  id: string;
  label: string;
  status: BacklogStatus;
};

export type EnsureNoteResponse = {
  path: string;
};

export type NoteContentResponse = {
  content: string;
};

export type ModeResponse = {
  mode: InteractionMode;
};

export type DesktopMetadata = {
  api_base_url: string;
  version: string;
};

export type DesktopDistributionStatus = {
  supported: boolean;
  cli: {
    bundled_path: string | null;
    install_path: string | null;
    bundled_cli_present: boolean;
    installed: boolean;
    managed_by_deepblock: boolean;
    blocked_by_existing_entry: boolean;
    shell_path_hint: string | null;
  };
  activitywatch: {
    enabled: boolean;
    configured_url: string;
    configured_port: number | null;
    local_url: boolean;
    automatic_runtime_enabled: boolean;
    system_install_detected: boolean;
    system_install_path: string | null;
    server_reachable: boolean;
    bundled_binaries_present: boolean;
    bundled_processes_running: boolean;
    preferred_source: 'existing_server' | 'system_install' | 'bundled_fallback' | 'none' | 'unsupported';
  };
};

export type ActivityWatchContextEvent = {
  timestamp: string;
  duration_seconds: number;
  app: string | null;
  title: string | null;
  url: string | null;
  domain: string | null;
  status: string | null;
};

export type ActivityWatchRankedItem = {
  label: string;
  detail: string | null;
  duration_seconds: number;
  percent: number;
};

export type ActivityWatchSummary = {
  hostname: string;
  server_version: string;
  device_id: string | null;
  watchers: Array<{
    kind: string;
    bucket_id: string;
    event_type: string;
    client: string;
    last_updated: string | null;
  }>;
  current_status: string;
  current_window: ActivityWatchContextEvent | null;
  current_web_tab: ActivityWatchContextEvent | null;
  today: {
    active_seconds: number;
    top_apps: ActivityWatchRankedItem[];
    top_domains: ActivityWatchRankedItem[];
    recent_windows: ActivityWatchContextEvent[];
  };
};

export type ClientConfig = {
  default_revision_copy_mode: RevisionCopyMode;
  revision_strategy: 'manual' | 'timed' | 'every_change' | 'never';
  revision_grace_minutes: number;
  start_hour: number;
  end_hour: number;
  pixels_per_minute: number;
  show_current_time_line: boolean;
  toast_duration_ms: number;
  time_format: '12h' | '24h';
  default_duration: number;
  default_type: BlockType;
  rounding_interval: number;
  min_duration: number;
  max_duration: number;
  notifications_enabled: boolean;
  notify_minutes_before: number;
  notify_on_block_start: boolean;
  notify_on_block_end: boolean;
  server_version: string;
};

const explicitApiBaseUrl = import.meta.env.VITE_API_BASE as string | undefined;
const fallbackWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
const fallbackRuntimeVersion = isTauriRuntime() ? 'dev' : 'web';

const desktopMetadataPromise: Promise<DesktopMetadata> = isTauriRuntime()
  ? invokeTauriCommand<DesktopMetadata>('desktop_metadata').catch(async () => ({
      api_base_url: await resolveBrowserApiBaseUrl(explicitApiBaseUrl),
      version: fallbackRuntimeVersion,
    }))
  : resolveBrowserApiBaseUrl(explicitApiBaseUrl).then((apiBaseUrl) => ({
      api_base_url: apiBaseUrl,
      version: fallbackRuntimeVersion,
    }));

async function apiBaseUrl(): Promise<string> {
  const metadata = await desktopMetadataPromise;
  return metadata.api_base_url.replace(/\/$/, '');
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = await apiBaseUrl();
  const generation = await ensureDataset(baseUrl);
  assertDataset();
  const headers: Record<string, string> = {
    'x-deepblock-dataset-generation': generation,
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (init?.body) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  const returnedGeneration = response.headers?.get('x-deepblock-dataset-generation');
  if (returnedGeneration && returnedGeneration !== generation) retireDataset();
  assertDataset();
  if (!response.ok) {
    const message = await response.text();
    if (response.status === 409) await checkDataset(baseUrl);
    throw new Error(message || `${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function getDesktopMetadata(): Promise<DesktopMetadata> {
  return desktopMetadataPromise;
}

export async function getDesktopDistributionStatus(): Promise<DesktopDistributionStatus> {
  return invokeTauriCommand<DesktopDistributionStatus>('desktop_distribution_status').catch(async () => {
    const status = await apiFetch<{ enabled: boolean; url: string; available: boolean }>('/activitywatch/status');
    const url = new URL(status.url);
    return {
      supported: false,
      cli: {
        bundled_path: null,
        install_path: null,
        bundled_cli_present: false,
        installed: false,
        managed_by_deepblock: false,
        blocked_by_existing_entry: false,
        shell_path_hint: null,
      },
      activitywatch: {
        enabled: status.enabled,
        configured_url: status.url,
        configured_port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        local_url: ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
        automatic_runtime_enabled: false,
        system_install_detected: false,
        system_install_path: null,
        server_reachable: status.available,
        bundled_binaries_present: false,
        bundled_processes_running: false,
        preferred_source: 'unsupported' as const,
      },
    };
  });
}

export async function installBundledDesktopCli(): Promise<DesktopDistributionStatus> {
  if (!isTauriRuntime()) {
    throw new Error('Bundled desktop tools are only available in the Tauri desktop app.');
  }

  return invokeTauriCommand<DesktopDistributionStatus>('desktop_install_bundled_cli');
}

export async function launchBundledActivityWatch(): Promise<DesktopDistributionStatus> {
  if (!isTauriRuntime()) {
    throw new Error('Bundled ActivityWatch controls are only available in the Tauri desktop app.');
  }

  return invokeTauriCommand<DesktopDistributionStatus>('desktop_launch_bundled_activitywatch');
}

export async function getWsUrl(): Promise<string> {
  if (fallbackWsUrl) {
    return fallbackWsUrl;
  }
  const metadata = await getDesktopMetadata();
  const base = metadata.api_base_url.replace(/\/$/, '');
  if (base.startsWith('/')) {
    // Same-origin base (dev proxy): derive the WebSocket URL from the page
    // location so the socket goes through the same /api proxy.
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${base}/ws/events`;
  }
  if (base.startsWith('https://')) {
    return `${base.replace(/^https/, 'wss')}/ws/events`;
  }
  return `${base.replace(/^http/, 'ws')}/ws/events`;
}

export async function getActivityWatchSummary(): Promise<ActivityWatchSummary> {
  return apiFetch<ActivityWatchSummary>('/activitywatch/summary');
}

export async function getMode(): Promise<ModeResponse> {
  return apiFetch<ModeResponse>('/mode');
}

export async function setMode(mode: InteractionMode): Promise<ModeResponse> {
  return apiFetch<ModeResponse>('/mode', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export async function getPlan(date?: string): Promise<DayPlan> {
  return apiFetch<DayPlan>(date ? `/plan/${date}` : '/plan/today');
}

function withDate(path: string, date?: string): string {
  if (!date) return path;
  return `${path}${path.includes('?') ? '&' : '?'}date=${date}`;
}

export async function addBlock(payload: {
  label: string;
  start: string;
  duration: number;
  type: BlockType;
  status?: BlockStatus;
  focus_rating?: number | null;
  actual_duration?: number | null;
  next_action?: string | null;
  content_path?: string | null;
}, date?: string): Promise<DayPlan> {
  return apiFetch<DayPlan>(withDate('/blocks', date), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateBlock(blockId: string, payload: Record<string, unknown>, date?: string): Promise<DayPlan> {
  return apiFetch<DayPlan>(withDate(`/blocks/${blockId}`, date), {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export type BlockOutcome = {
  actual_duration?: number | null;
  focus_rating?: number | null;
  completed?: boolean | null;
};

export async function saveBlockOutcome(blockId: string, payload: BlockOutcome, date: string): Promise<DayPlan> {
  return apiFetch<DayPlan>(withDate(`/blocks/${blockId}/outcome`, date), {
    method: 'PATCH', body: JSON.stringify(payload),
  });
}

export async function deleteBlock(blockId: string, date?: string): Promise<DayPlan> {
  return apiFetch<DayPlan>(withDate(`/blocks/${blockId}`, date), {
    method: 'DELETE',
  });
}

export async function revisePlan(payload: { reason?: string; copy_mode?: RevisionCopyMode }): Promise<DayPlan> {
  return apiFetch<DayPlan>('/plan/revise', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export type ReplanBatchOperation =
  | {
      op: 'create';
      block_id?: string;
      label: string;
      start: string;
      duration: number;
      type: BlockType;
      status?: BlockStatus;
      focus_rating?: number | null;
      next_action?: string | null;
      content_path?: string | null;
    }
  | { op: 'update'; block_id: string } & Record<string, unknown>
  | { op: 'delete'; block_id: string };

export async function replanBatch(
  payload: { reason?: string; base_revision?: Revision; copy_mode?: RevisionCopyMode; operations: ReplanBatchOperation[] },
  date?: string,
): Promise<DayPlan> {
  return apiFetch<DayPlan>(withDate('/plan/replan', date), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function auditPlan(): Promise<DayPlan> {
  return apiFetch<DayPlan>('/plan/audit', {
    method: 'POST',
  });
}

export async function undoPlan(): Promise<DayPlan> {
  return apiFetch<DayPlan>('/plan/undo', {
    method: 'POST',
  });
}

export async function redoPlan(): Promise<DayPlan> {
  return apiFetch<DayPlan>('/plan/redo', {
    method: 'POST',
  });
}

export async function addArtifact(blockId: string, artifact: string, date?: string): Promise<DayPlan> {
  return apiFetch<DayPlan>(withDate(`/blocks/${blockId}/artifacts`, date), {
    method: 'POST',
    body: JSON.stringify({ artifact }),
  });
}

export async function removeArtifact(blockId: string, artifact: string, date?: string): Promise<DayPlan> {
  const query = new URLSearchParams({ artifact }).toString();
  return apiFetch<DayPlan>(withDate(`/blocks/${blockId}/artifacts?${query}`, date), {
    method: 'DELETE',
  });
}

export async function comparePlan(base?: string, compare?: string, date?: string): Promise<PlanComparison> {
  const query = new URLSearchParams();
  if (date) query.set('date', date);
  if (base) query.set('base', base);
  if (compare) query.set('compare', compare);
  const suffix = query.toString();
  return apiFetch<PlanComparison>(`/plan/compare${suffix ? `?${suffix}` : ''}`);
}

export async function getPlanReview(date?: string): Promise<PlanReviewResponse> {
  // Without a date the server reviews today's plan.
  return apiFetch<PlanReviewResponse>(date ? `/plan/review?date=${date}` : '/plan/review');
}


export async function getBacklog(): Promise<BacklogItem[]> {
  return apiFetch<BacklogItem[]>('/backlog');
}

export async function createBacklogTask(label: string): Promise<BacklogItem[]> {
  return apiFetch<BacklogItem[]>('/backlog', {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

export async function updateBacklogTask(taskId: string, status: BacklogStatus): Promise<BacklogItem[]> {
  return apiFetch<BacklogItem[]>(`/backlog/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function deleteBacklogTask(taskId: string): Promise<BacklogItem[]> {
  return apiFetch<BacklogItem[]>(`/backlog/${taskId}`, {
    method: 'DELETE',
  });
}

export async function ensureNote(): Promise<EnsureNoteResponse> {
  return apiFetch<EnsureNoteResponse>('/notes/ensure', {
    method: 'POST',
  });
}

export async function getNote(date: string): Promise<NoteContentResponse> {
  return apiFetch<NoteContentResponse>(`/notes/${date}`);
}

export async function saveNote(date: string, content: string): Promise<NoteContentResponse> {
  return apiFetch<NoteContentResponse>(`/notes/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function getConfig(): Promise<ClientConfig> {
  return apiFetch<ClientConfig>('/config');
}

export async function patchConfig(payload: Partial<ClientConfig>): Promise<ClientConfig> {
  return apiFetch<ClientConfig>('/config', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function initializeDataset() { return ensureDataset(await apiBaseUrl()); }
export async function refreshDatasetIdentity() { return checkDataset(await apiBaseUrl()); }
export type StorageStatus = { generation: string; recovery_available: boolean; unavailable: boolean };
export type StorageCounts = { days: number; revisions: number; intent_snapshots: number; backlog_items: number; projects: number; goals: number; notes: number; first_date: string | null; last_date: string | null };
export type ImportPreview = { preview_id: string; current: StorageCounts; incoming: StorageCounts; notes_added: string[]; notes_overwritten: string[]; notes_removed: string[]; configuration_included: boolean };
export function getStorageStatus(): Promise<StorageStatus> { return apiFetch('/storage/status'); }
export function previewRecovery(): Promise<ImportPreview> { return apiFetch('/storage/recovery/preview', { method: 'POST' }); }
export async function previewImport(file: File): Promise<ImportPreview | null> {
  if (isTauriRuntime()) return invokeTauriCommand<ImportPreview | null>('desktop_import_preview');
  if (file.size > 1024 * 1024 * 1024) throw new Error('Import exceeds 1 GiB.');
  return apiFetch('/storage/import/preview', { method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: file });
}
export async function nativeImportPreview(): Promise<ImportPreview | null> { return invokeTauriCommand('desktop_import_preview'); }
export async function commitImport(previewId: string) {
  const result = await apiFetch<{ generation: string }>('/storage/import/commit', { method: 'POST', body: JSON.stringify({preview_id: previewId}) });
  retireDataset();
  return result;
}
export async function downloadBundle(recovery = false): Promise<boolean> {
  if (isTauriRuntime()) return invokeTauriCommand<boolean>('desktop_export_bundle', { recovery });
  const base = await apiBaseUrl();
  assertDataset();
  const response = await fetch(`${base}/storage/${recovery ? 'recovery' : 'export'}`);
  if (!response.ok) throw new Error(await response.text());
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = recovery ? 'deepblock-recovery.zip' : 'deepblock-export.zip';
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export type IntentSnapshot = {version: string; recorded_at: string; date: string; revision_id: string; blocks: Array<{block_id: string; label: string; start: string; duration: number; status: string; next_action: string | null; project: Project | null; goal: Goal | null}>};
export function getIntentHistory(date: string): Promise<IntentSnapshot[]> { return apiFetch(`/intent/${date}/history`); }
