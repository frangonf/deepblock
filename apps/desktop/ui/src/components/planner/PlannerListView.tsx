import { useState } from "react";
import {
  ClipboardPenLine,
  Eye,
  EyeOff,
  GripVertical,
  PencilLine,
  Trash2,
  Check,
  RotateCcw,
} from "lucide-react";

import type { Block, BlockStatus, Revision } from "@/lib/api";
import { formatMinutes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  dropZoneTone,
  labelTone,
  startTimeForDrop,
} from "@/components/planner/shared";

type DragState = {
  blockId: string;
  revisionId: string;
} | null;

export function PlannerListView({
  revisions,
  activeRevisionId,
  canEdit,
  onEditBlock,
  onOpenArtifacts,
  canManageArtifacts = true,
  onDeleteBlock,
  onStatusChange,
  onMoveBlock,
  onRepositionBlock,
}: {
  revisions: Revision[];
  activeRevisionId: string | null;
  canEdit: boolean;
  onEditBlock: (block: Block) => void;
  onOpenArtifacts: (block: Block) => void;
  canManageArtifacts?: boolean;
  onDeleteBlock: (blockId: string) => void;
  onStatusChange: (blockId: string, status: BlockStatus) => void;
  onMoveBlock: (blockId: string, direction: -1 | 1) => void;
  onRepositionBlock: (blockId: string, start: string) => Promise<void>;
}) {
  const [dragState, setDragState] = useState<DragState>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const resetDragState = () => {
    setDragState(null);
    setDropIndex(null);
  };

  const handleBlockDrop = async (
    revision: Revision | null,
    nextDropIndex: number,
  ) => {
    if (!revision || !dragState || dragState.revisionId !== revision.id) {
      resetDragState();
      return;
    }

    const targetStart = startTimeForDrop(
      revision.blocks,
      dragState.blockId,
      nextDropIndex,
    );
    resetDragState();

    if (!targetStart) return;
    const draggedBlock = revision.blocks.find(
      (block) => block.id === dragState.blockId,
    );
    if (!draggedBlock || draggedBlock.start === targetStart) return;

    await onRepositionBlock(dragState.blockId, targetStart);
  };

  const activeRevision = revisions.find(
    (revision) => revision.id === activeRevisionId,
  );
  const historyRevisions = revisions
    .filter((revision) => revision.id !== activeRevisionId)
    .slice()
    .reverse();

  const renderRevisionCard = (revision: Revision, revisionIndex: number) => {
    const isActiveRevision = revision.id === activeRevisionId;
    return (
      <Card
        key={revision.id}
        className={isActiveRevision ? "border-sky-400/40" : undefined}
        data-testid="revision-column"
        data-revision-id={revision.id}
      >
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                Revision {revision.id}
                {isActiveRevision ? (
                  <Badge className="status-info">{canEdit ? "editable" : "read-only"}</Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {revision.reason ||
                  (revisionIndex === 0 && !isActiveRevision
                    ? "Initial plan"
                    : "No reason recorded")}
              </CardDescription>
            </div>
            <Badge>{revision.blocks.length} blocks</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {revision.blocks.length === 0 ? (
            <div
              className="rounded-[var(--db-radius)] border border-dashed border-line p-4 text-sm text-muted"
              onDragOver={(event) => {
                if (!canEdit || !isActiveRevision || !dragState) return;
                event.preventDefault();
                setDropIndex(0);
              }}
              onDrop={(event) => {
                if (!canEdit || !isActiveRevision) return;
                event.preventDefault();
                void handleBlockDrop(revision, 0);
              }}
            >
              No blocks scheduled in this revision.
            </div>
          ) : (
            <>
              {revision.blocks.map((block, blockIndex) => {
                const canDrag = canEdit && isActiveRevision;
                const isDragging = dragState?.blockId === block.id;
                const isDropTarget =
                  canDrag &&
                  dragState?.revisionId === revision.id &&
                  dropIndex === blockIndex;

                return (
                  <div key={block.id} className="grid gap-3">
                    <div
                      className={`h-3 rounded-full border border-dashed transition ${dropZoneTone(isDropTarget)}`}
                      data-drop-index={blockIndex}
                      data-testid={isDropTarget ? "drop-indicator" : undefined}
                      onDragOver={(event) => {
                        if (!canDrag || !dragState) return;
                        event.preventDefault();
                        setDropIndex(blockIndex);
                      }}
                      onDrop={(event) => {
                        if (!canDrag) return;
                        event.preventDefault();
                        void handleBlockDrop(revision, blockIndex);
                      }}
                    />
                    <div
                      className={`rounded-[var(--db-radius)] border border-line bg-raised p-4 transition ${
                        isDragging
                          ? "border-dashed border-accent/70 bg-accent/10 opacity-60"
                          : ""
                      }`}
                      data-testid="planner-block"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-medium text-ink">
                              {block.label}
                            </h3>
                            <Badge className={labelTone(block.type)}>
                              {block.type}
                            </Badge>
                            <Badge>{block.status}</Badge>
                          </div>
                          <div className="text-sm text-muted">
                            {block.start} · {formatMinutes(block.duration)}
                            {block.focus_rating
                              ? ` · focus ${block.focus_rating}/5`
                              : ""}
                          </div>
                          {block.next_action ? (
                            <p className="text-sm text-muted">
                              Next: {block.next_action}
                            </p>
                          ) : null}
                          {block.artifacts.length > 0 ? (
                            <div className="flex flex-wrap gap-2 text-xs text-muted">
                              {block.artifacts.map((artifact) => (
                                <span
                                  key={artifact}
                                  className="rounded-full border border-line px-2 py-1"
                                >
                                  {artifact}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              onStatusChange(
                                block.id,
                                block.status === "done" ? "proposed" : "done",
                              )
                            }
                            disabled={!canDrag}
                          >
                            {block.status === "done" ? (
                              <RotateCcw className="h-3.5 w-3.5" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            {block.status === "done" ? "Reopen" : "Mark done"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={canDrag ? "Drag to reorder" : undefined}
                            draggable={canDrag}
                            onDragStart={(event) => {
                              if (!canDrag) return;
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                "text/plain",
                                block.id,
                              );
                              setDragState({
                                blockId: block.id,
                                revisionId: revision.id,
                              });
                              setDropIndex(blockIndex);
                            }}
                            onDragEnd={resetDragState}
                            disabled={!canDrag}
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                            Drag
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEditBlock(block)}
                            disabled={!canEdit || !isActiveRevision}
                          >
                            <PencilLine className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenArtifacts(block)}
                            disabled={!canManageArtifacts}
                            title={
                              !canManageArtifacts
                                ? "Save or discard draft changes before managing artifacts"
                                : undefined
                            }
                          >
                            <ClipboardPenLine className="h-3.5 w-3.5" />
                            Artifacts
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onMoveBlock(block.id, -1)}
                            disabled={
                              !canEdit || !isActiveRevision || blockIndex === 0
                            }
                          >
                            Up
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onMoveBlock(block.id, 1)}
                            disabled={
                              !canEdit ||
                              !isActiveRevision ||
                              blockIndex === revision.blocks.length - 1
                            }
                          >
                            Down
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDeleteBlock(block.id)}
                            disabled={!canEdit || !isActiveRevision}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div
                className={`h-3 rounded-full border border-dashed transition ${
                  canEdit &&
                  isActiveRevision &&
                  dragState?.revisionId === revision.id &&
                  dropIndex === revision.blocks.length
                    ? dropZoneTone(true)
                    : dropZoneTone(false)
                }`}
                data-drop-index={revision.blocks.length}
                data-testid={
                  dropIndex === revision.blocks.length
                    ? "drop-indicator"
                    : undefined
                }
                onDragOver={(event) => {
                  if (!canEdit || !isActiveRevision || !dragState) return;
                  event.preventDefault();
                  setDropIndex(revision.blocks.length);
                }}
                onDrop={(event) => {
                  if (!canEdit || !isActiveRevision) return;
                  event.preventDefault();
                  void handleBlockDrop(revision, revision.blocks.length);
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="grid w-full min-w-0 gap-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowHistory((current) => !current)}
          disabled={revisions.length <= 1}
        >
          {showHistory ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          {showHistory ? "Hide history" : "Show history"}
        </Button>
      </div>
      <div className="grid gap-6">
        {activeRevision
          ? renderRevisionCard(activeRevision, historyRevisions.length)
          : null}

        {showHistory && historyRevisions.length > 0 ? (
          <div className="grid gap-6 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex items-center gap-4 py-2 opacity-50">
              <div className="h-px flex-1 bg-line" />
              <span className="text-xs uppercase tracking-widest text-ink">
                Past intent
              </span>
              <div className="h-px flex-1 bg-line" />
            </div>
            {historyRevisions.map((revision, index) =>
              renderRevisionCard(revision, historyRevisions.length - 1 - index),
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
