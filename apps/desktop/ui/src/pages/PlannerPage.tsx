import { PlannerContext } from '@/components/planner/PlannerContext';
import { DayNavigation } from "@/components/day-navigation";
import { useSelectedDate } from "@/hooks/use-selected-date";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CalendarDays,
  LayoutGrid,
  NotebookTabs,
  Plus,
  RotateCcw,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  addArtifact,
  auditPlan,
  redoPlan,
  removeArtifact,
  replanBatch,
  type ReplanBatchOperation,
  revisePlan,
  type Block,
  type BlockStatus,
  type BlockType,
  undoPlan,
} from "@/lib/api";
import { useConfig } from "@/hooks/use-config";
import { useDayPlan } from "@/hooks/use-day-plan";
import { usePlannerDraft } from "@/hooks/use-planner-draft";
import { formatMinutes, formatTime, parseTime, todayString } from "@/lib/utils";
import {
  ArtifactDialog,
  BlockDialog,
  type BlockDialogInitialValues,
  RevisionDialog,
} from "@/components/planner/PlannerDialogs";
import { PlannerCalendarView } from "@/components/planner/PlannerCalendarView";
import { PlannerDraftControls } from "@/components/planner/PlannerDraftControls";
import { PlannerListView } from "@/components/planner/PlannerListView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PlannerViewMode = "calendar" | "list";

export function PlannerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useSelectedDate();
  const [plannerView, setPlannerView] = useState<PlannerViewMode>("calendar");
  const [blockDialogInitialValues, setBlockDialogInitialValues] = useState<
    BlockDialogInitialValues | undefined
  >(undefined);
  const [editingBlock, setEditingBlock] = useState<Block | null>(null);
  const [isBlockDialogOpen, setIsBlockDialogOpen] = useState(false);
  const [isRevisionDialogOpen, setIsRevisionDialogOpen] = useState(false);
  const [artifactBlock, setArtifactBlock] = useState<Block | null>(null);
  const isCommittingDraft =
    useIsMutating({ mutationKey: ["planner-draft"] }) > 0;
  const queryClient = useQueryClient();

  const planQuery = useDayPlan(
    selectedDate === todayString() ? undefined : selectedDate,
  );
  const configQuery = useConfig();
  const activeMutationDate =
    selectedDate === todayString() ? undefined : selectedDate;

  const invalidatePlan = async () => {
    await queryClient.invalidateQueries({ queryKey: ["plan"] });
    await queryClient.invalidateQueries({ queryKey: ["compare"] });
  };

  const reviseMutation = useMutation({
    mutationFn: revisePlan,
    onSuccess: async () => {
      toast.success("Revision created");
      await invalidatePlan();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const artifactAddMutation = useMutation({
    mutationFn: ({
      blockId,
      artifact,
    }: {
      blockId: string;
      artifact: string;
    }) => addArtifact(blockId, artifact, activeMutationDate),
    onSuccess: async () => {
      await invalidatePlan();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const artifactRemoveMutation = useMutation({
    mutationFn: ({
      blockId,
      artifact,
    }: {
      blockId: string;
      artifact: string;
    }) => removeArtifact(blockId, artifact, activeMutationDate),
    onSuccess: async () => {
      await invalidatePlan();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const auditMutation = useMutation({
    mutationFn: auditPlan,
    onSuccess: async () => {
      toast.success("Reality audit refreshed");
      await invalidatePlan();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const undoMutation = useMutation({
    mutationFn: undoPlan,
    onSuccess: async () => {
      toast.success("Undid latest change");
      await invalidatePlan();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const redoMutation = useMutation({
    mutationFn: redoPlan,
    onSuccess: async () => {
      toast.success("Reapplied latest change");
      await invalidatePlan();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const plan = planQuery.data;
  const activeRevision = useMemo(() => plan?.revisions.at(-1) ?? null, [plan]);
  const isToday = selectedDate === todayString();
  const canEdit = selectedDate >= todayString();
  const draft = usePlannerDraft(
    selectedDate,
    activeRevision,
    isCommittingDraft,
  );
  const currentDraftBlocks = draft.blocks;
  const isDraftDirty = draft.dirty;
  const stageDraftCreate = draft.create;
  const stageDraftUpdate = (blockId: string, payload: Record<string, unknown>) => {
    try { draft.update(blockId, payload); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Cannot fit these blocks into the day.'); return false; }
  };
  const stageDraftDelete = draft.remove;
  const discardDraft = draft.discard;

  const commitDraftMutation = useMutation({
    mutationKey: ["planner-draft"],
    mutationFn: async ({
      date,
      submittedDraft,
    }: {
      date: string;
      submittedDraft: ReturnType<typeof usePlannerDraft>;
    }) => {
      if (
        !submittedDraft.baseRevision ||
        submittedDraft.operations.length === 0
      )
        return null;
      if (submittedDraft.conflict)
        throw new Error(
          "The saved plan changed. Rebase or discard your retained draft before committing.",
        );

      const operations = submittedDraft.operations.map<ReplanBatchOperation>(
        (operation) => {
          if (operation.type === "create") {
            return {
              op: "create",
              // The draft id lets later operations in the same batch reference
              // this block; the server resolves it to a generated id.
              block_id: operation.block.id,
              label: operation.block.label,
              start: operation.block.start,
              duration: operation.block.duration,
              type: operation.block.type,
              status: operation.block.status,
              focus_rating: operation.block.focus_rating,
              next_action: operation.block.next_action,
              content_path: operation.block.content_path,
            };
          }

          if (operation.type === "update") {
            return {
              op: "update",
              block_id: operation.blockId,
              ...operation.payload,
            };
          }

          return { op: "delete", block_id: operation.blockId };
        },
      );

      return replanBatch(
        {
          reason: submittedDraft.reason.trim() || `Replanned from ${submittedDraft.baseRevision.id}`,
          base_revision: submittedDraft.baseRevision,
          copy_mode: "all",
          operations,
        },
        date,
      );
    },
    onSuccess: async (response, { date, submittedDraft }) => {
      if (!response) return;
      queryClient.setQueryData(
        ["plan", date === todayString() ? "today" : date],
        response,
      );
      // React Query updates callbacks when this mounted page changes dates.
      // Complete the submitted draft, never the currently displayed one.
      submittedDraft.complete();
      toast.success("Revised plan saved");
      await invalidatePlan();
    },
    onError: async (error: Error) => {
      toast.error(error.message);
      await invalidatePlan();
    },
  });

  const currentCalendarRevision = useMemo(() => {
    if (!activeRevision) {
      return null;
    }

    if (!canEdit) {
      return activeRevision;
    }

    return {
      ...activeRevision,
      blocks: currentDraftBlocks,
    };
  }, [activeRevision, currentDraftBlocks, canEdit]);

  const historyRevisions = useMemo(
    () =>
      plan?.revisions.filter(
        (revision) => revision.id !== activeRevision?.id,
      ) ?? [],
    [plan?.revisions, activeRevision?.id],
  );

  const openNewBlockDialog = (initialValues?: BlockDialogInitialValues) => {
    setEditingBlock(null);
    setBlockDialogInitialValues(initialValues);
    setIsBlockDialogOpen(true);
  };

  const queuedLabel = searchParams.get("schedule");
  const queuedInitialValues =
    queuedLabel && isToday
      ? {
          label: queuedLabel,
          duration: configQuery.data?.default_duration ?? 60,
          type: configQuery.data?.default_type ?? "focus",
        }
      : undefined;
  const blockDialogOpen = Boolean(
    isBlockDialogOpen ||
      (queuedInitialValues &&
        activeRevision &&
        !planQuery.isLoading &&
        !configQuery.isLoading),
  );

  const openEditBlockDialog = (block: Block) => {
    setBlockDialogInitialValues(undefined);
    setEditingBlock(block);
    setIsBlockDialogOpen(true);
  };

  const stageMove = (blockId: string, direction: -1 | 1) => {
    const ordered = currentDraftBlocks.filter((block) => block.status !== 'cancelled');
    const index = ordered.findIndex((block) => block.id === blockId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const first = Math.min(index, target);
    let minutes = parseTime(ordered[first].start);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const updates = ordered.slice(first).map((block) => {
      const start = minutes;
      minutes += block.duration;
      return { id: block.id, start: formatTime(start) };
    });
    if (minutes > 1440) {
      toast.error(
        "Moving these blocks would extend beyond the end of the day.",
      );
      return;
    }
    try {
      draft.updateMany(updates.map((update) => ({ blockId: update.id, payload: { start: update.start } })));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Cannot fit these blocks into the day.');
    }
  };

  return (
    <div className="grid gap-3" data-testid="planner-workspace">
      <div className="planner-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <DayNavigation
            date={selectedDate}
            onChange={setSelectedDate}
            disabled={isCommittingDraft}
          />
          {activeRevision ? (
            <Badge>Active revision {activeRevision.id}</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() =>
              openNewBlockDialog({
                duration: configQuery.data?.default_duration ?? 60,
                type: configQuery.data?.default_type ?? "focus",
              })
            }
            disabled={!canEdit || isCommittingDraft || !activeRevision}
          >
            <Plus className="h-4 w-4" />
            Add block
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to={`/notes?date=${selectedDate}`}>
              <NotebookTabs className="h-4 w-4" />
              Notes
            </Link>
          </Button>
          <details className="relative">
            <summary className="cursor-pointer rounded-[var(--db-radius)] border border-line px-3 py-1.5 text-sm text-muted">
              Plan actions
            </summary>
            <div className="absolute right-0 z-20 mt-2 grid w-52 gap-1 rounded-[var(--db-radius)] border border-line bg-surface p-2 shadow-[0_4px_16px_var(--db-shadow)]">
              {!isToday ? <p className="p-2 text-xs text-muted">These saved-history actions and activity audits are available for today. For future days, edit blocks and save a revised plan.</p> : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsRevisionDialogOpen(true)}
                disabled={
                  !isToday || !plan || isCommittingDraft || isDraftDirty
                }
              >
                <Sparkles className="h-4 w-4" />
                Revise
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => undoMutation.mutate()}
                disabled={
                  !isToday ||
                  undoMutation.isPending ||
                  isCommittingDraft ||
                  isDraftDirty
                }
              >
                <RotateCcw className="h-4 w-4" />
                Undo saved change
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => redoMutation.mutate()}
                disabled={
                  !isToday ||
                  redoMutation.isPending ||
                  isCommittingDraft ||
                  isDraftDirty
                }
              >
                <RotateCw className="h-4 w-4" />
                Redo saved change
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => auditMutation.mutate()}
                disabled={
                  !isToday ||
                  auditMutation.isPending ||
                  isCommittingDraft ||
                  isDraftDirty
                }
              >
                Refresh observed activity
              </Button>
            </div>
          </details>
        </div>
      </div>
      {activeRevision ? (
        <div className="planner-day-summary" aria-label="Day summary">
          <span>
            {
              currentDraftBlocks.filter((block) => block.status !== "cancelled")
                .length
            }{" "}
            blocks
          </span>
          <span>
            {formatMinutes(
              currentDraftBlocks
                .filter((block) => block.status !== "cancelled")
                .reduce((total, block) => total + block.duration, 0),
            )}{" "}
            planned
          </span>
          <span>
            {formatMinutes(
              currentDraftBlocks
                .filter(
                  (block) =>
                    block.type === "focus" && block.status !== "cancelled",
                )
                .reduce((total, block) => total + block.duration, 0),
            )}{" "}
            focus
          </span>
          <span>
            {
              currentDraftBlocks.filter((block) => block.status === "done")
                .length
            }{" "}
            completed
          </span>
        </div>
      ) : null}
      {canEdit && activeRevision ? (
        <PlannerDraftControls
          dirty={isDraftDirty}
          saving={isCommittingDraft}
          conflict={draft.conflict}
          error={commitDraftMutation.error?.message}
          changeCount={draft.changeCount}
          reason={draft.reason}
          onReasonChange={draft.setReason}
          onSave={async () => {
            await commitDraftMutation.mutateAsync({
              date: selectedDate,
              submittedDraft: draft,
            });
          }}
          onDiscard={discardDraft}
          onRebase={() => {
            try {
              draft.rebase();
            } catch (error) {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Could not apply edits to the latest plan",
              );
            }
          }}
        />
      ) : !canEdit ? (
        <p className="text-sm text-muted">Past plans are read-only. Choose today or a future date to plan.</p>
      ) : null}

      {planQuery.isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted">
            Loading planner...
          </CardContent>
        </Card>
      ) : planQuery.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-danger">
            {planQuery.error.message}
          </CardContent>
        </Card>
      ) : !plan ? null : (
        <Card className="planner-plan">
          <CardContent className="p-3">
            <Tabs
              value={plannerView}
              onValueChange={(value) =>
                setPlannerView(value as PlannerViewMode)
              }
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <TabsList>
                  <TabsTrigger
                    value="calendar"
                    data-testid="planner-view-calendar"
                  >
                    <CalendarDays className="h-4 w-4" />
                    Calendar
                  </TabsTrigger>
                  <TabsTrigger value="list" data-testid="planner-view-list">
                    <LayoutGrid className="h-4 w-4" />
                    List
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="calendar">
                <PlannerCalendarView
                  historyRevisions={historyRevisions}
                  selectedDate={selectedDate}
                  currentRevision={currentCalendarRevision}
                  savedRevision={activeRevision ?? undefined}
                  canEdit={canEdit}
                  isCommittingDraft={isCommittingDraft}
                  config={configQuery.data}
                  onDraftCreate={stageDraftCreate}
                  onDraftUpdate={stageDraftUpdate}
                  onDraftDelete={stageDraftDelete}
                />
              </TabsContent>

              <TabsContent value="list">
                <PlannerListView
                  revisions={plan.revisions.map((revision) =>
                    revision.id === activeRevision?.id &&
                    currentCalendarRevision
                      ? currentCalendarRevision
                      : revision,
                  )}
                  activeRevisionId={activeRevision?.id ?? null}
                  canEdit={canEdit && !isCommittingDraft}
                  onEditBlock={openEditBlockDialog}
                  canManageArtifacts={canEdit && !isDraftDirty && !isCommittingDraft}
                  onOpenArtifacts={setArtifactBlock}
                  onDeleteBlock={stageDraftDelete}
                  onStatusChange={(blockId, status) =>
                    stageDraftUpdate(blockId, { status })
                  }
                  onMoveBlock={stageMove}
                  onRepositionBlock={async (blockId, start) => {
                    stageDraftUpdate(blockId, { start });
                  }}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <PlannerContext blocks={currentDraftBlocks} onUpdate={stageDraftUpdate} disabled={!canEdit || isCommittingDraft} />

      <BlockDialog
        open={blockDialogOpen}
        block={editingBlock}
        initialValues={queuedInitialValues ?? blockDialogInitialValues}
        onOpenChange={(open) => {
          setIsBlockDialogOpen(open);
          if (!open) {
            setEditingBlock(null);
            setBlockDialogInitialValues(undefined);
            if (queuedLabel) {
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.delete("schedule");
                  return next;
                },
                { replace: true },
              );
            }
          }
        }}
        onSubmit={async (payload) => {
          const nextDraftPayload = {
            label: String(payload.label),
            start: String(payload.start),
            duration: Number(payload.duration),
            type: payload.type as BlockType,
            status: payload.status as BlockStatus,
            focus_rating:
              (payload.focus_rating as number | null | undefined) ?? null,
            next_action:
              (payload.next_action as string | null | undefined) ?? null,
            content_path:
              (payload.content_path as string | null | undefined) ?? null,
          };

          if (editingBlock) draft.update(editingBlock.id, nextDraftPayload);
          else stageDraftCreate(nextDraftPayload);
        }}
        onDelete={
          editingBlock
            ? async () => {
                stageDraftDelete(editingBlock.id);
              }
            : undefined
        }
      />
      <RevisionDialog
        open={isRevisionDialogOpen}
        onOpenChange={setIsRevisionDialogOpen}
        onSubmit={async (payload) => {
          await reviseMutation.mutateAsync(payload);
        }}
      />
      <ArtifactDialog
        block={
          activeRevision?.blocks.find(
            (block) => block.id === artifactBlock?.id,
          ) ?? artifactBlock
        }
        open={Boolean(artifactBlock)}
        onOpenChange={(open) => !open && setArtifactBlock(null)}
        onAdd={async (artifact) => {
          if (!artifactBlock) return;
          await artifactAddMutation.mutateAsync({
            blockId: artifactBlock.id,
            artifact,
          });
        }}
        onRemove={async (artifact) => {
          if (!artifactBlock) return;
          await artifactRemoveMutation.mutateAsync({
            blockId: artifactBlock.id,
            artifact,
          });
        }}
      />
    </div>
  );
}
