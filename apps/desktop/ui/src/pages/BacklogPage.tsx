import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CheckCheck, Clock3, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createBacklogTask,
  deleteBacklogTask,
  getBacklog,
  type BacklogItem,
  type BacklogStatus,
  updateBacklogTask,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { todayString } from "@/lib/utils";

const columns: Array<{ status: BacklogStatus; title: string }> = [
  { status: "todo", title: "To do" },
  { status: "inprogress", title: "In progress" },
  { status: "done", title: "Done" },
];

function nextStatus(status: BacklogStatus): BacklogStatus {
  switch (status) {
    case "todo":
      return "inprogress";
    case "inprogress":
      return "done";
    default:
      return "todo";
  }
}

export function BacklogPage() {
  const [newTask, setNewTask] = useState("");
  const queryClient = useQueryClient();
  const backlogQuery = useQuery({ queryKey: ["backlog"], queryFn: getBacklog });
  const refresh = async () =>
    queryClient.invalidateQueries({ queryKey: ["backlog"] });

  const createMutation = useMutation({
    mutationFn: createBacklogTask,
    onSuccess: async () => {
      setNewTask("");
      toast.success("Backlog task added");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      taskId,
      status,
    }: {
      taskId: string;
      status: BacklogStatus;
    }) => updateBacklogTask(taskId, status),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteBacklogTask,
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const backlog = backlogQuery.data ?? [];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Backlog board</CardTitle>
          <CardDescription>
            Capture tasks here, then schedule them when you are ready.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!newTask.trim()) return;
              await createMutation.mutateAsync(newTask.trim());
            }}
          >
            <Input
              aria-label="New task"
              className="min-w-0 flex-1"
              data-testid="backlog-input"
              value={newTask}
              onChange={(event) => setNewTask(event.target.value)}
              placeholder="Capture an unscheduled task"
            />
            <Button type="submit" className="shrink-0 whitespace-nowrap" disabled={!newTask.trim() || createMutation.isPending}>
              <Plus className="h-4 w-4" />
              Add task
            </Button>
          </form>
        </CardContent>
      </Card>

      {backlogQuery.isLoading ? <p role="status" className="text-sm text-muted">Loading tasks…</p> : backlogQuery.error ? <p role="alert" className="text-sm text-danger">Could not load tasks: {backlogQuery.error.message}</p> : backlog.length === 0 ? <Card><CardHeader><CardTitle>Your backlog is clear</CardTitle><CardDescription>Capture an unscheduled task above. You can start it or add it to today’s plan.</CardDescription></CardHeader></Card> : (
      <div className="grid gap-4 md:grid-cols-3">
        {columns.map((column) => (
          <Card key={column.status}>
            <CardHeader>
              <CardTitle>{column.title}</CardTitle>
              <CardDescription>
                {backlog.filter((item) => item.status === column.status).length}{" "}
                task(s)
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {backlog
                .filter((item) => item.status === column.status)
                .map((item: BacklogItem) => (
                  <div
                    key={item.id}
                    className="rounded-[var(--db-radius)] border border-line bg-raised p-4"
                    data-testid={`backlog-${item.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-ink">{item.label}</div>
                        <div className="mt-1 text-xs text-muted">{item.id}</div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {item.status !== "done" ? (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              to={`/planner?date=${todayString()}&schedule=${encodeURIComponent(item.label)}`}
                            >
                              <CalendarPlus className="h-3.5 w-3.5" />
                              Schedule today
                            </Link>
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updateMutation.mutate({
                              taskId: item.id,
                              status: nextStatus(item.status),
                            })
                          }
                        >
                          {item.status === "done" ? (
                            <Clock3 className="h-3.5 w-3.5" />
                          ) : (
                            <CheckCheck className="h-3.5 w-3.5" />
                          )}
                          {item.status === "done"
                            ? "Reopen"
                            : item.status === "todo"
                              ? "Start task"
                              : "Complete task"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(item.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              {backlog.filter((item) => item.status === column.status)
                .length === 0 ? (
                <div className="rounded-[var(--db-radius)] border border-dashed border-line p-4 text-sm text-muted">
                  No tasks here yet.
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      )}
    </div>
  );
}
