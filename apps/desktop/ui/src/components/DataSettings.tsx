import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commitImport,
  downloadBundle,
  getStorageStatus,
  nativeImportPreview,
  previewImport,
  previewRecovery,
  type ImportPreview,
  type StorageCounts,
} from "@/lib/api";
import { draftNamespace, pendingDrafts, hasDirtyForms } from "@/lib/dataset";
import { invokeTauriCommand, isTauriRuntime } from "@/lib/runtime";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function countDescription(value: StorageCounts) {
  return `${value.days} days, ${value.revisions} revisions, ${value.intent_snapshots} intent snapshots, ${value.backlog_items} backlog items, ${value.projects} projects, ${value.goals} goals and ${value.notes} notes`;
}
export function DataSettings() {
  const client = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const status = useQuery({
    queryKey: ["storage-status"],
    queryFn: getStorageStatus,
  });
  const select = useMutation({
    mutationFn: async (file: File | "recovery" | "native") =>
      file === "recovery"
        ? previewRecovery()
        : file === "native"
          ? nativeImportPreview()
          : previewImport(file),
    onSuccess: (result) => {
      setPreview(result);
      setConfirmed(false);
    },
  });
  const download = useMutation({
    mutationFn: downloadBundle,
    onSuccess: (saved) =>
      setNotice(saved ? "Bundle download completed." : "Save cancelled."),
  });
  const restore = useMutation({
    mutationFn: async () => {
      const cacheDrafts = client
        .getQueryCache()
        .findAll({ queryKey: ["note-draft", draftNamespace()] })
        .some((q) => q.state.data != null);
      if (
        pendingDrafts() ||
        cacheDrafts ||
        hasDirtyForms() ||
        client.isMutating() > 1
      )
        throw new Error(
          "Save or explicitly discard your pending planner, note and Settings edits before replacing data.",
        );
      if (!preview || !confirmed) throw new Error("Confirm replacement first.");
      return commitImport(preview.preview_id);
    },
  });
  const recoverDrafts = async () => {
    const entries: Record<string, string | null> = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (
        key &&
        (key.startsWith("deepblock.note-draft.") ||
          key.startsWith("deepblock.planner-draft."))
      )
        entries[key] = sessionStorage.getItem(key);
    }
    for (const query of client
      .getQueryCache()
      .findAll({ queryKey: ["note-draft"] })) {
      if (query.state.data != null)
        entries[`query:${JSON.stringify(query.queryKey)}`] = String(
          query.state.data,
        );
    }
    const content = JSON.stringify(entries, null, 2);
    if (isTauriRuntime()) {
      const saved = await invokeTauriCommand<boolean>("desktop_export_drafts", {
        content,
      });
      if (!saved) {
        setNotice("Save cancelled.");
        return;
      }
    } else {
      const url = URL.createObjectURL(
        new Blob([content], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "deepblock-unsaved-drafts.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    setNotice(
      "Draft recovery exported. Older drafts require manual review before reapplying.",
    );
  };
  const error = select.error || download.error || restore.error || status.error;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
        <CardDescription>
          Portable ZIP bundles include all saved planning data, managed Markdown
          notes and configuration. External documents and linked attachments
          remain references.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={download.isPending}
            onClick={() => download.mutate(false)}
          >
            Export bundle
          </Button>
          <Button
            disabled={select.isPending || !status.data}
            onClick={() =>
              isTauriRuntime()
                ? select.mutate("native")
                : picker.current?.click()
            }
          >
            Import bundle
          </Button>
        </div>
        <input
          ref={picker}
          type="file"
          accept=".zip,.json"
          aria-label="Import file"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) select.mutate(file);
            event.target.value = "";
          }}
        />
        <p className="text-sm text-muted">
          {status.data?.recovery_available
            ? "A recovery bundle from the last successful replacement is available."
            : "A recovery bundle is created automatically before replacing data."}
        </p>
        {status.data?.recovery_available && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={download.isPending}
              onClick={() => download.mutate(true)}
            >
              Download recovery
            </Button>
            <Button
              disabled={select.isPending}
              onClick={() => select.mutate("recovery")}
            >
              Restore recovery
            </Button>
          </div>
        )}
        <p className="text-sm text-muted">
          Unsaved drafts are separate from saved-data bundles. Older drafts are
          retained after replacement and can be exported for manual recovery.
        </p>
        <Button
          variant="outline"
          onClick={() =>
            void recoverDrafts().catch((error: unknown) =>
              setNotice(String(error)),
            )
          }
        >
          Export unsaved drafts
        </Button>
        {(select.isPending || download.isPending) && (
          <p role="status">Preparing bundle…</p>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error.message}</p>}
        <Dialog
          open={preview != null}
          onOpenChange={(open) => {
            if (!open && !restore.isPending) {
              setPreview(null);
              restore.reset();
            }
          }}
        >
          <DialogContent>
            <DialogTitle>Replace saved data?</DialogTitle>
            <DialogDescription>
              This replaces all planning data and managed daily notes. Your
              current settings stay. A complete recovery ZIP is saved
              automatically; external files are left untouched.
            </DialogDescription>
            {preview && (
              <div className="my-4 grid gap-3 text-sm">
                <p>Current: {countDescription(preview.current)}</p>
                <p>Incoming: {countDescription(preview.incoming)}</p>
                <p>
                  Incoming dates: {preview.incoming.first_date ?? "None"} –{" "}
                  {preview.incoming.last_date ?? "None"}
                </p>
                <p>
                  Notes: {preview.notes_added.length} added,{" "}
                  {preview.notes_overwritten.length} overwritten,{" "}
                  {preview.notes_removed.length} removed.
                </p>
                {preview.notes_removed.length > 0 && (
                  <p>Removed note dates: {preview.notes_removed.join(", ")}</p>
                )}
                <p>
                  {preview.configuration_included
                    ? "The bundle contains configuration; it will not be applied."
                    : "The bundle does not contain configuration."}
                </p>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I understand this replaces my saved data and notes.
                </label>
              </div>
            )}
            {restore.error && <p role="alert">{restore.error.message}</p>}
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                disabled={restore.isPending}
                onClick={() => {
                  setPreview(null);
                  restore.reset();
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={!confirmed || restore.isPending}
                onClick={() => restore.mutate()}
              >
                {restore.isPending ? "Replacing…" : "Replace data"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
