import { useSelectedDate } from '@/hooks/use-selected-date';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNoteAutosave } from '@/hooks/use-note-autosave';
import { FilePenLine, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';

import { ensureNote, getNote } from '@/lib/api';
import { todayString } from '@/lib/utils';
import { DayNavigation } from '@/components/day-navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export function NotesPage() {
  const [date, setDate] = useSelectedDate();

  const noteQuery = useQuery({ queryKey: ['notes', date], queryFn: () => getNote(date) });
  const ensureMutation = useMutation({
    mutationFn: ensureNote,
    onSuccess: (response) => toast.success(`Note ready at ${response.path}`),
    onError: (error: Error) => toast.error(error.message),
  });
  const autosave = useNoteAutosave(date, noteQuery.error ? undefined : noteQuery.data?.content);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily note</CardTitle>
          <CardDescription>Keep a daily note alongside your plan. Edits save automatically.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <DayNavigation date={date} onChange={setDate} />
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button variant="outline" onClick={() => ensureMutation.mutate()} disabled={date !== todayString() || ensureMutation.isPending} title={date !== todayString() ? "This creates today’s note file; editing automatically saves the selected day’s note" : undefined}>
              <FolderOpen className="h-4 w-4" />
              Create today’s note file
            </Button>
            {autosave.error ? <Button onClick={autosave.retry}>Retry save</Button> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Markdown editor</CardTitle>
          <CardDescription>Use this as the daily narrative layer behind revisions, focus shifts, and audit findings.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            data-testid="notes-editor"
            aria-label="Daily note"
            disabled={noteQuery.isLoading || Boolean(noteQuery.error)}
            className="min-h-[26rem]"
            value={autosave.content}
            onChange={(event) => autosave.update(event.target.value)}
            placeholder={'# Daily note\n\nWhat changed? Why?'}
          />
          <div className="mt-4 flex items-center gap-2 text-sm text-muted">
            <FilePenLine className="h-4 w-4" />
            <span role="status">{noteQuery.isLoading ? 'Loading note…' : noteQuery.error ? 'Could not load this note. Try again before editing.' : autosave.error ? 'Save failed. Your edits are retained; retry saving.' : autosave.saving ? 'Saving…' : 'Saved'}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
