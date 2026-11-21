import { useState } from 'react';

import type { Block, RevisionCopyMode } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { copyModeOptions } from '@/components/planner/shared';
import { BlockFields, SelectField, useBlockForm, type BlockFormInitialValues as BlockDialogInitialValues } from './BlockFields';

export type { BlockFormInitialValues as BlockDialogInitialValues } from './BlockFields';

function BlockDialogForm({
  block,
  initialValues,
  onOpenChange,
  onSubmit,
  onDelete,
}: {
  block: Block | null;
  initialValues?: BlockDialogInitialValues;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const form = useBlockForm(block, initialValues);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{block ? 'Edit block' : 'Add block'}</DialogTitle>
        <DialogDescription>
          Changes join your draft. Save the revised plan when you are ready. Label, start and duration are required.
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setIsSubmitting(true);
          setSubmitError(null);
          try {
            await onSubmit(form.payload);
            onOpenChange(false);
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : 'Could not apply this block.');
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        {submitError && <p role="alert" className="text-sm text-danger">{submitError}</p>}
        <BlockFields form={form} />
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            {block && onDelete ? (
              <Button
                variant="danger"
                type="button"
                disabled={isDeleting || isSubmitting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await onDelete();
                    onOpenChange(false);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
              >
                {isDeleting ? 'Deleting...' : 'Delete block'}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isDeleting}>
              {isSubmitting ? 'Saving...' : 'Apply to draft'}
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  );
}

export function BlockDialog({
  open,
  block,
  initialValues,
  onOpenChange,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  block: Block | null;
  initialValues?: BlockDialogInitialValues;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const dialogKey = block?.id ?? `new:${initialValues?.start ?? '09:00'}:${initialValues?.duration ?? '60'}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <BlockDialogForm
          key={dialogKey}
          block={block}
          initialValues={initialValues}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          onDelete={onDelete}
        />
      ) : null}
    </Dialog>
  );
}

export function RevisionDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { reason?: string; copy_mode?: RevisionCopyMode }) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [copyMode, setCopyMode] = useState<RevisionCopyMode>('all');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revise the day</DialogTitle>
          <DialogDescription>Create a new revision column and choose how much of the current plan carries forward.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await onSubmit({ reason: reason || undefined, copy_mode: copyMode });
            setReason('');
            setCopyMode('all');
            onOpenChange(false);
          }}
        >
          <label className="grid gap-2 text-sm text-muted">
            <span>Reason</span>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is the plan changing?" />
          </label>
          <SelectField value={copyMode} onChange={(value) => setCopyMode(value as RevisionCopyMode)} options={copyModeOptions} label="Carry forward" />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create revision</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ArtifactDialog({
  block,
  open,
  onOpenChange,
  onAdd,
  onRemove,
}: {
  block: Block | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (value: string) => Promise<void>;
  onRemove: (value: string) => Promise<void>;
}) {
  const [artifact, setArtifact] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Artifacts</DialogTitle>
          <DialogDescription>Attach proof of output such as URLs, paths, or delivery notes to {block?.label ?? 'this block'}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3">
            {(block?.artifacts ?? []).length === 0 ? (
              <div className="rounded-[var(--db-radius)] border border-dashed border-line p-4 text-sm text-muted">No artifacts yet.</div>
            ) : (
              block?.artifacts.map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-[var(--db-radius)] border border-line bg-raised p-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{item}</span>
                  <Button variant="ghost" size="sm" onClick={() => void onRemove(item)}>
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!artifact.trim()) return;
              await onAdd(artifact.trim());
              setArtifact('');
            }}
          >
            <Input value={artifact} onChange={(event) => setArtifact(event.target.value)} placeholder="https://github.com/... or docs/notes.md" />
            <div className="flex justify-end gap-3">
              <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Button type="submit">Add artifact</Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
