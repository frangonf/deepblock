import { draftNamespace } from '@/lib/dataset';
import { useCallback, useEffect } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { saveNote } from '@/lib/api';

const storagePrefix = 'deepblock.note-draft.v2:';
const currentPrefix = () => `${storagePrefix}${draftNamespace()}:`;
const keyFor = (date: string) => `${currentPrefix()}${date}`;
const draftKey = (date: string) => ['note-draft', draftNamespace(), date];
type Submission = { date: string; content: string };

function recover(date: string): string | null {
  try { return sessionStorage.getItem(keyFor(date)); }
  catch { return null; }
}

// Installed in the app shell so leaving Notes does not remove the guard.
export function useNoteUnloadWarning() {
  const client = useQueryClient();
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      let pending = client.getQueryCache().findAll({ queryKey: ['note-draft'] }).some((query) => query.state.data != null);
      try {
        for (let index = 0; index < sessionStorage.length && !pending; index++) {
          pending = sessionStorage.key(index)?.startsWith(storagePrefix) ?? false;
        }
      } catch { /* The cache still detects drafts when storage is denied. */ }
      if (pending) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [client]);
}

// The query cache keeps drafts across routes even if session storage is denied.
// Hook-level mutation callbacks also finish after the editor unmounts.
export function useNoteAutosave(date: string, savedContent: string | undefined) {
  const client = useQueryClient();
  const draft = useQuery({
    queryKey: draftKey(date), queryFn: () => recover(date),
    initialData: () => recover(date), enabled: false, gcTime: Infinity,
  }).data;
  const pending = useIsMutating({ mutationKey: ['note-save'], predicate: (entry) => (entry.state.variables as Submission | undefined)?.date === date }) > 0;
  const mutation = useMutation({
    mutationKey: ['note-save'],
    scope: { id: 'note-autosave' },
    mutationFn: ({ date, content }: Submission) => saveNote(date, content),
    onSuccess: async (response, submitted) => {
      // A read started before the write must not replace acknowledged text.
      await client.cancelQueries({ queryKey: ['notes', submitted.date], exact: true });
      client.setQueryData(['notes', submitted.date], response);
      const remaining = client.getMutationCache().findAll({ mutationKey: ['note-save'], status: 'pending' })
        .filter((entry) => (entry.state.variables as Submission).date === submitted.date);
      if (remaining.length === 1 && client.getQueryData(draftKey(submitted.date)) === submitted.content) {
        client.setQueryData(draftKey(submitted.date), null);
        try { sessionStorage.removeItem(keyFor(submitted.date)); } catch { /* Cache recovery still works. */ }
      }
    },
  });
  const error = mutation.variables?.date === date ? mutation.error : null;
  const { mutate, reset } = mutation;
  const flush = useCallback((day: string) => {
    const content = client.getQueryData<string | null>(draftKey(day));
    if (content == null) return;
    const latest = client.getMutationCache().findAll({ mutationKey: ['note-save'], status: 'pending' })
      .map((entry) => entry.state.variables as Submission).filter((entry) => entry.date === day).at(-1);
    if (latest?.content !== content) mutate({ date: day, content });
  }, [client, mutate]);

  const content = draft ?? savedContent ?? '';
  const dirty = draft != null;
  useEffect(() => {
    if (!dirty || savedContent === undefined || pending || error) return;
    const timer = window.setTimeout(() => flush(date), 750);
    return () => window.clearTimeout(timer);
  }, [date, dirty, content, flush, error, pending, savedContent]);

  useEffect(() => () => flush(date), [date, flush]);

  const update = (content: string) => {
    reset();
    client.setQueryData(draftKey(date), content);
    try { sessionStorage.setItem(keyFor(date), content); } catch { /* Keep the cache draft. */ }
  };
  return { content, update, retry: () => flush(date), error, saving: pending || dirty };
}
