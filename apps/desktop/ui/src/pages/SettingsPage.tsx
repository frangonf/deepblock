import { DataSettings } from '@/components/DataSettings';
import { setFormDirty } from '@/lib/dataset';
import { ContextSettings } from '@/components/ContextSettings';
import { AdvancedModulesStatus } from '@/components/AdvancedModulesStatus';
import { Select } from '@/components/ui/select';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

import {
  getDesktopMetadata,
  installBundledDesktopCli,
  launchBundledActivityWatch,
  patchConfig,
  type BlockType,
  type ClientConfig,
  type DesktopDistributionStatus,
  type RevisionCopyMode,
} from '@/lib/api';
import { useConfig } from '@/hooks/use-config';
import { useDesktopDistribution } from '@/hooks/use-desktop-distribution';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

const blockTypes: BlockType[] = ['focus', 'shallow', 'urgent', 'break'];
const copyModes: RevisionCopyMode[] = ['all', 'from_now', 'empty'];
const revisionStrategies: ClientConfig['revision_strategy'][] = ['manual', 'timed', 'every_change', 'never'];

function cliStatusMessage(status: DesktopDistributionStatus | undefined): string {
  if (!status?.supported) {
    return 'Desktop install controls are only available from the packaged macOS app.';
  }
  if (!status.cli.bundled_cli_present) {
    return 'This app build does not currently expose a bundled deepb binary.';
  }
  if (status.cli.managed_by_deepblock) {
    return `Bundled deepb is linked at ${status.cli.install_path}.`;
  }
  if (status.cli.blocked_by_existing_entry) {
    return `DeepBlock left the existing entry at ${status.cli.install_path} untouched.`;
  }
  return `Bundled deepb is available and can be installed at ${status.cli.install_path}.`;
}

function activityWatchStatusMessage(status: DesktopDistributionStatus | undefined): string {
  if (!status?.supported) {
    return 'Bundled ActivityWatch controls are only available from the packaged macOS app.';
  }
  if (status.activitywatch.server_reachable) {
    return `An existing ActivityWatch server is already reachable at ${status.activitywatch.configured_url}.`;
  }
  if (status.activitywatch.system_install_detected) {
    return `DeepBlock will prefer the installed ActivityWatch app at ${status.activitywatch.system_install_path}.`;
  }
  if (status.activitywatch.bundled_binaries_present) {
    return 'No existing ActivityWatch install was detected, so the bundled fallback is available.';
  }
  return 'No local ActivityWatch runtime is currently available.';
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const configQuery = useConfig();
  const metadataQuery = useQuery({ queryKey: ['desktop-metadata'], queryFn: getDesktopMetadata });
  const distributionQuery = useDesktopDistribution();
  const [draft, setDraft] = useState<Partial<ClientConfig> | null>(null);
  const saveMutation = useMutation({
    mutationFn: patchConfig,
    onSuccess: async (response) => {
      setDraft(response);
      queryClient.setQueryData(['config'], response);
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      toast.success('Settings saved');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const installCliMutation = useMutation({
    mutationFn: installBundledDesktopCli,
    onSuccess: async (status) => {
      queryClient.setQueryData(['desktop-distribution'], status);
      await queryClient.invalidateQueries({ queryKey: ['desktop-distribution'] });
      if (status.cli.managed_by_deepblock) {
        toast.success('Bundled deepb is now installed for this user');
      } else if (status.cli.blocked_by_existing_entry) {
        toast.success('Existing deepb entry was preserved');
      } else {
        toast.success('Desktop CLI status refreshed');
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const launchBundledActivityWatchMutation = useMutation({
    mutationFn: launchBundledActivityWatch,
    onSuccess: async (status) => {
      queryClient.setQueryData(['desktop-distribution'], status);
      await queryClient.invalidateQueries({ queryKey: ['desktop-distribution'] });
      if (status.activitywatch.server_reachable) {
        toast.success('ActivityWatch is available');
      } else {
        toast.success('Bundled ActivityWatch fallback did not replace any existing setup');
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const values = draft ?? configQuery.data;
  const distribution = distributionQuery.data;
  useEffect(() => {
    setFormDirty('settings', draft != null && JSON.stringify(draft) !== JSON.stringify(configQuery.data));
    return () => setFormDirty('settings', false);
  }, [draft, configQuery.data]);

  const updateDraft = <K extends keyof ClientConfig>(key: K, value: ClientConfig[K]) => {
    setDraft((current) => ({ ...(current ?? configQuery.data ?? {}), [key]: value }));
  };

  return (
    <div className="grid max-w-4xl gap-6">
      <DataSettings />
      <ContextSettings />
      <AdvancedModulesStatus />
      <Card>
        <CardHeader><CardTitle>About DeepBlock</CardTitle><CardDescription>Local planning with preserved revision history.</CardDescription></CardHeader>
        <CardContent className="text-sm text-muted">
          {metadataQuery.data ? `Version ${metadataQuery.data.version}` : 'Connecting to backend…'}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Planning defaults</CardTitle>
          <CardDescription>These defaults apply to your plans in both the browser and desktop app.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-muted">
            <span>Default revision copy mode</span>
            <Select

              value={values?.default_revision_copy_mode}
              onChange={(event) => updateDraft('default_revision_copy_mode', event.target.value as RevisionCopyMode)}
            >
              {copyModes.map((mode) => (
                <option key={mode} value={mode} className="bg-canvas">
                  {mode}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm text-muted">
            <span>Automatic revision strategy</span>
            <Select

              value={values?.revision_strategy}
              onChange={(event) => updateDraft('revision_strategy', event.target.value as ClientConfig['revision_strategy'])}
            >
              {revisionStrategies.map((strategy) => (
                <option key={strategy} value={strategy} className="bg-canvas">
                  {strategy}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm text-muted">
            <span>Timed-strategy grace minutes</span>
            <Input
              type="number"
              min={0}
              value={values?.revision_grace_minutes ?? 5}
              onChange={(event) => updateDraft('revision_grace_minutes', Number(event.target.value))}
            />
          </label>
          <label className="grid gap-2 text-sm text-muted">
            <span>Default block type</span>
            <Select

              value={values?.default_type}
              onChange={(event) => updateDraft('default_type', event.target.value as BlockType)}
            >
              {blockTypes.map((type) => (
                <option key={type} value={type} className="bg-canvas">
                  {type}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm text-muted">
            <span>Default duration (minutes)</span>
            <Input type="number" value={values?.default_duration ?? 60} onChange={(event) => updateDraft('default_duration', Number(event.target.value))} />
          </label>
          <label className="grid gap-2 text-sm text-muted">
            <span>Rounding interval (minutes)</span>
            <Input type="number" value={values?.rounding_interval ?? 15} onChange={(event) => updateDraft('rounding_interval', Number(event.target.value))} />
          </label>
          <label className="grid gap-2 text-sm text-muted">
            <span>Start hour (0–23)</span>
            <Input type="number" value={values?.start_hour ?? 0} onChange={(event) => updateDraft('start_hour', Number(event.target.value))} />
          </label>
          <label className="grid gap-2 text-sm text-muted">
            <span>End hour (1–24)</span>
            <Input type="number" value={values?.end_hour ?? 24} onChange={(event) => updateDraft('end_hour', Number(event.target.value))} />
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Time-based block reminders</CardTitle>
          <CardDescription>
            Optional local notifications from the shared UI. In Tauri they use the native desktop bridge; in the browser
            they use the Web Notification API when it is available.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="flex items-center gap-3 rounded-[var(--db-radius)] border border-line bg-raised px-4 py-3 text-sm text-ink">
            <Switch
              checked={values?.notifications_enabled ?? true}
              onCheckedChange={(checked) => updateDraft('notifications_enabled', checked)}
            />
            Enable local block reminders
          </label>
          <label className="grid gap-2 text-sm text-muted">
            <span>Notify minutes before</span>
            <Input
              type="number"
              min={0}
              value={values?.notify_minutes_before ?? 5}
              onChange={(event) => updateDraft('notify_minutes_before', Number(event.target.value))}
            />
          </label>
          <label className="flex items-center gap-3 rounded-[var(--db-radius)] border border-line bg-raised px-4 py-3 text-sm text-ink">
            <Switch
              checked={values?.notify_on_block_start ?? true}
              onCheckedChange={(checked) => updateDraft('notify_on_block_start', checked)}
            />
            Remind when a block is about to begin
          </label>
          <label className="flex items-center gap-3 rounded-[var(--db-radius)] border border-line bg-raised px-4 py-3 text-sm text-ink">
            <Switch
              checked={values?.notify_on_block_end ?? true}
              onCheckedChange={(checked) => updateDraft('notify_on_block_end', checked)}
            />
            Remind when a block is about to finish
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bundled desktop tools</CardTitle>
          <CardDescription>
            These controls are specific to the packaged macOS Tauri app. DeepBlock prefers an already installed
            ActivityWatch instance and only uses the bundled toolchain when you explicitly need it or no system install
            exists.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 rounded-[var(--db-radius)] border border-line bg-raised p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-ink">Bundled deepb CLI</div>
                <div className="text-sm text-muted">{cliStatusMessage(distribution)}</div>
              </div>
              <Button
                variant="outline"
                onClick={() => installCliMutation.mutate()}
                disabled={!distribution?.supported || !distribution.cli.bundled_cli_present || installCliMutation.isPending}
              >
                Install bundled deepb
              </Button>
            </div>
            {distribution?.supported && (
              <div className="grid gap-1 text-xs text-muted">
                {distribution.cli.bundled_path && <div>Bundled binary: {distribution.cli.bundled_path}</div>}
                {distribution.cli.shell_path_hint && <div>{distribution.cli.shell_path_hint}</div>}
              </div>
            )}
          </div>
          <div className="grid gap-2 rounded-[var(--db-radius)] border border-line bg-raised p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-ink">ActivityWatch runtime</div>
                <div className="text-sm text-muted">{activityWatchStatusMessage(distribution)}</div>
              </div>
              <Button
                variant="outline"
                onClick={() => launchBundledActivityWatchMutation.mutate()}
                disabled={
                  !distribution?.supported ||
                  !distribution.activitywatch.bundled_binaries_present ||
                  distribution.activitywatch.server_reachable ||
                  !distribution.activitywatch.local_url ||
                  launchBundledActivityWatchMutation.isPending
                }
              >
                Launch bundled fallback
              </Button>
            </div>
            {distribution?.supported && (
              <div className="grid gap-1 text-xs text-muted">
                <div>Configured URL: {distribution.activitywatch.configured_url}</div>
                <div>Preferred source: {distribution.activitywatch.preferred_source.replace(/_/g, ' ')}</div>
                {distribution.activitywatch.system_install_path && (
                  <div>Installed ActivityWatch.app: {distribution.activitywatch.system_install_path}</div>
                )}
                {!distribution.activitywatch.local_url && (
                  <div>Bundled runtime management is limited to local ActivityWatch URLs.</div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={() => values && saveMutation.mutate(values)} disabled={saveMutation.isPending || !values} data-testid="save-settings">
          <Save className="h-4 w-4" />
          Save settings
        </Button>
      </div>
    </div>
  );
}
