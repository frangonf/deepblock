import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getContext,
  saveContext,
  type Project,
  type ContextCatalog,
} from "@/lib/api";
import { setFormDirty } from "@/lib/dataset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

type Edit = {
  kind: "project" | "goal";
  id: string;
  label: string;
  ownership: Project["ownership"];
  base: ContextCatalog;
};
export function ContextSettings() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["context"], queryFn: getContext });
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [ownership, setOwnership] = useState<Project["ownership"]>("personal");
  const [edit, setEdit] = useState<Edit | null>(null);
  useEffect(() => {
    setFormDirty("context", Boolean(name || goal || edit));
    return () => setFormDirty("context", false);
  }, [name, goal, edit]);
  const mutation = useMutation({
    mutationFn: async (kind: "project" | "goal" | "edit") => {
      if (!query.data) throw new Error("Reload context before saving.");
      if (kind === "edit") {
        if (!edit) throw new Error("Choose a project or goal to edit.");
        const catalog =
          edit.kind === "project"
            ? {
                ...edit.base,
                projects: edit.base.projects.map((p) =>
                  p.id === edit.id
                    ? {
                        ...p,
                        name: edit.label.trim(),
                        ownership: edit.ownership,
                      }
                    : p,
                ),
              }
            : {
                ...edit.base,
                goals: edit.base.goals.map((g) =>
                  g.id === edit.id ? { ...g, label: edit.label.trim() } : g,
                ),
              };
        return saveContext(edit.base, catalog);
      }
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const catalog =
        kind === "project"
          ? {
              ...query.data,
              projects: [
                ...query.data.projects,
                { id, name: name.trim(), ownership },
              ],
            }
          : {
              ...query.data,
              goals: [...query.data.goals, { id, label: goal.trim() }],
            };
      return saveContext(query.data, catalog);
    },
    onSuccess: async (catalog, kind) => {
      client.setQueryData(["context"], catalog);
      if (kind === "project") setName("");
      else if (kind === "goal") setGoal("");
      else setEdit(null);
      await client.invalidateQueries({ queryKey: ["context"] });
      await client.invalidateQueries({ queryKey: ["intent-history"] });
      await client.invalidateQueries({ queryKey: ["plan"] });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ["context"] });
    },
  });
  const startEdit = (value: Edit) => {
    mutation.reset();
    setEdit(value);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Projects and goals</CardTitle>
        <CardDescription>
          Optional context for personal, employer and client work. Goals can
          span projects.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {query.isError && (
          <p role="alert">
            Could not load context.{" "}
            <Button onClick={() => void query.refetch()}>Retry</Button>
          </p>
        )}
        {mutation.error && <p role="alert">{mutation.error.message}</p>}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate("project");
          }}
        >
          <Input
            aria-label="Project name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
          />
          <Select
            aria-label="Project ownership"
            value={ownership}
            onChange={(e) =>
              setOwnership(e.target.value as Project["ownership"])
            }
          >
            <option value="personal">Personal</option>
            <option value="employer">Employer</option>
            <option value="client">Client</option>
          </Select>
          <Button disabled={!query.data || !name.trim() || mutation.isPending}>
            Add project
          </Button>
        </form>
        <ul className="grid gap-2 text-sm text-muted">
          {query.data?.projects.map((p) => (
            <li key={p.id}>
              <span>
                {p.name} · {p.ownership}
              </span>{" "}
              <Button
                variant="outline"
                aria-label={`Edit project ${p.name}`}
                disabled={mutation.isPending}
                onClick={() =>
                  query.data &&
                  startEdit({
                    kind: "project",
                    id: p.id,
                    label: p.name,
                    ownership: p.ownership,
                    base: query.data,
                  })
                }
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate("goal");
          }}
        >
          <Input
            aria-label="Goal label"
            required
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Intended outcome"
          />
          <Button disabled={!query.data || !goal.trim() || mutation.isPending}>
            Add goal
          </Button>
        </form>
        <ul className="grid gap-2 text-sm text-muted">
          {query.data?.goals.map((g) => (
            <li key={g.id}>
              <span>{g.label}</span>{" "}
              <Button
                variant="outline"
                aria-label={`Edit goal ${g.label}`}
                disabled={mutation.isPending}
                onClick={() =>
                  query.data &&
                  startEdit({
                    kind: "goal",
                    id: g.id,
                    label: g.label,
                    ownership: "personal",
                    base: query.data,
                  })
                }
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
        {edit && (
          <form
            className="grid gap-2 rounded border border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate("edit");
            }}
          >
            <Input
              aria-label="Edited context label"
              value={edit.label}
              onChange={(e) => setEdit({ ...edit, label: e.target.value })}
              required
            />
            {edit.kind === "project" && (
              <Select
                aria-label="Edited project ownership"
                value={edit.ownership}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    ownership: e.target.value as Project["ownership"],
                  })
                }
              >
                <option value="personal">Personal</option>
                <option value="employer">Employer</option>
                <option value="client">Client</option>
              </Select>
            )}
            <div className="flex gap-2">
              <Button disabled={!edit.label.trim() || mutation.isPending}>
                Save context edit
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => {
                  setEdit(null);
                  mutation.reset();
                }}
              >
                Cancel edit
              </Button>
              {mutation.error && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const fresh = await query.refetch();
                    if (fresh.data) {
                      setEdit({ ...edit, base: fresh.data });
                      mutation.reset();
                    }
                  }}
                >
                  Review against latest context
                </Button>
              )}
            </div>
            <p className="text-sm text-muted">
              Identity stays unchanged. Older intent snapshots keep their
              recorded labels.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
