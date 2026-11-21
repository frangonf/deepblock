import { formatMinutes } from "@/lib/utils";

function fieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "")
    return "not recorded";
  if (field === "duration" || field === "actual_duration")
    return formatMinutes(Number(value));
  if (field === "focus_rating") return `${String(value)}/5`;
  if (Array.isArray(value))
    return value.length ? value.map(String).join(", ") : "none";
  if (typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key.replace(/_/g, " ")}: ${String(item)}`)
      .join("; ");
  return String(value);
}

export function describeBlockChanges(
  details: Record<string, unknown>,
): string[] {
  return Object.entries(details).map(([field, value]) => {
    const label =
      field === "start"
        ? "Start time"
        : field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");
    if (
      value &&
      typeof value === "object" &&
      "before" in value &&
      "after" in value
    ) {
      const change = value as { before: unknown; after: unknown };
      return `${label}: ${fieldValue(field, change.before)} → ${fieldValue(field, change.after)}`;
    }
    return `${label}: ${fieldValue(field, value)}`;
  });
}
