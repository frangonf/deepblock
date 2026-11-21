import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function PlannerDraftControls({ dirty, saving, conflict, error, changeCount, reason, onReasonChange, onSave, onDiscard, onRebase }: {
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  error?: string;
  changeCount: number;
  reason: string;
  onReasonChange: (reason: string) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onRebase: () => void;
}) {
  return (
    <div className="planner-draft-controls grid gap-2" data-dirty={dirty}>
      <div className="planner-save-bar">
        <span role="status" className="text-sm text-muted">
          {saving ? 'Saving revised plan…' : dirty ? `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'}` : 'All changes saved'}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" data-testid="planner-discard-draft" onClick={onDiscard} disabled={!dirty || saving}>Discard changes</Button>
          <Button size="sm" data-testid="planner-commit-replan" onClick={() => { void onSave().catch(() => { /* Mutation errors are shown by the planner. */ }); }} disabled={!dirty || saving || conflict}>
            {saving ? 'Saving…' : 'Save revised plan'}
          </Button>
        </div>
      </div>
      {dirty && <label className="grid gap-1 text-sm text-muted">
        <span>Reason (optional)</span>
        <Input value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={saving} placeholder="What prompted this revision?" />
      </label>}
      {error && dirty && !conflict && <p role="alert" className="status-danger rounded-[var(--db-radius)] border p-3 text-sm">{error} Your draft is retained. Try saving again.</p>}
      {conflict && (
        <div role="alert" data-testid="planner-draft-conflict" className="rounded-[var(--db-radius)] border status-warning p-3 text-sm">
          The saved plan changed elsewhere. Your edits are retained. Apply them to the latest plan or discard them before saving.
          <Button variant="outline" size="sm" className="ml-3" onClick={onRebase} disabled={saving}>Apply edits to latest plan</Button>
        </div>
      )}
    </div>
  );
}
