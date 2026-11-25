import { Ellipsis, Undo2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function PlannerDraftControls({ dirty, saving, conflict, error, changeCount, reason, onReasonChange, onSave, onDiscard, onRebase, onUndo }: {
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
  onUndo?: () => void;
}) {
  return (
    <div className="planner-draft-controls" data-dirty={dirty}>
      {error && dirty && !conflict && <p role="alert" className="status-danger rounded-[var(--db-radius)] border p-2 text-sm">{error} Your draft is retained. Try saving again.</p>}
      {conflict && (
        <div role="alert" data-testid="planner-draft-conflict" className="status-warning rounded-[var(--db-radius)] border p-2 text-sm">
          The saved plan changed elsewhere. Your edits are retained. Apply them to the latest plan or discard them before saving.
          <Button variant="outline" size="sm" className="ml-2" onClick={onRebase} disabled={saving}>Apply edits to latest plan</Button>
        </div>
      )}
      <div className="planner-save-bar">
        <span role="status" className="planner-save-bar__status text-sm text-muted">
          {saving ? 'Saving revised plan…' : dirty ? `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'}` : 'All changes saved'}
        </span>
        {dirty && onUndo && (
          <Button variant="ghost" size="sm" onClick={onUndo} disabled={saving} aria-label="Undo edit" title="Undo edit" aria-keyshortcuts="Control+Z Meta+Z">
            <Undo2 aria-hidden="true" className="size-4" />
            <span className="planner-save-bar__wide-label">Undo edit</span>
          </Button>
        )}
        <Button size="sm" aria-label={saving ? 'Saving…' : 'Save revised plan'} aria-keyshortcuts="Control+S Meta+S" data-testid="planner-commit-replan" onClick={() => { void onSave().catch(() => { /* Mutation errors are shown by the planner. */ }); }} disabled={!dirty || saving || conflict}>
          <span className="planner-save-bar__wide-label">{saving ? 'Saving…' : 'Save revised plan'}</span>
          <span className="planner-save-bar__short-label">{saving ? 'Saving…' : 'Save'}</span>
        </Button>
        {dirty && (
          <details className="relative">
            <summary aria-label="Draft actions" title="Draft actions" className="db-button inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[var(--db-radius)] border border-line px-3 text-sm text-muted">
              <Ellipsis aria-hidden="true" className="size-4" />
              <span className="planner-save-bar__wide-label">Draft actions</span>
            </summary>
            <div className="planner-save-bar__details absolute right-0 bottom-full z-20 mb-2 grid gap-2 rounded-[var(--db-radius)] border border-line bg-surface p-3 shadow-[0_4px_16px_var(--db-shadow)]">
              <label className="grid gap-1 text-sm text-muted">
                <span>Reason (optional)</span>
                <Input value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={saving} placeholder="What prompted this revision?" />
              </label>
              <Button variant="ghost" size="sm" data-testid="planner-discard-draft" onClick={onDiscard} disabled={saving}>Discard changes</Button>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
