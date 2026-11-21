import { useQuery } from "@tanstack/react-query";
import { getIntentHistory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
export function IntentHistory({ date }: { date: string }) {
  const query = useQuery({
    queryKey: ["intent-history", date],
    queryFn: () => getIntentHistory(date),
  });
  return (
    <Card data-testid="intent-history">
      <CardHeader>
        <CardTitle>Intent history</CardTitle>
        <CardDescription>
          Saved intentions for {date}. Historical labels and schedules remain as
          recorded.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {query.isLoading && <p>Loading intent history…</p>}
        {query.error && (
          <p role="alert">
            {query.error.message}{" "}
            <Button onClick={() => void query.refetch()}>Retry</Button>
          </p>
        )}
        {query.data?.length === 0 && (
          <p>No saved intent snapshots for this day.</p>
        )}
        {query.data?.map((snapshot) => (
          <details key={snapshot.version}>
            <summary className="cursor-pointer text-sm">
              {snapshot.recorded_at} · Revision {snapshot.revision_id} ·{" "}
              {snapshot.blocks.length} blocks
            </summary>
            <ul className="mt-2 grid gap-2 text-sm">
              {snapshot.blocks.map((block) => (
                <li key={block.block_id}>
                  {block.start} · {block.duration} min · {block.label} ·{" "}
                  {block.status}
                  <br />
                  {block.project
                    ? `${block.project.name} · ${block.project.ownership}`
                    : "Unassigned project"}{" "}
                  · {block.goal?.label ?? "Unassigned goal"}
                  {block.next_action && <p>Next action: {block.next_action}</p>}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}
