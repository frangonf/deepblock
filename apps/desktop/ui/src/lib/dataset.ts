// A browser session stays bound to the dataset it opened. Replacement never
// upgrades queued writes; reload starts a new session and preserves old drafts.
let generation = "";
let retired = false;
let initialized: Promise<string> | null = null;
export const datasetChangedEvent = "deepblock:dataset-replaced";
export function datasetGeneration() {
  return generation;
}
export function draftNamespace() {
  return generation || "unscoped";
}
export function retireDataset() {
  if (retired) return;
  retired = true;
  window.dispatchEvent(new Event(datasetChangedEvent));
}
export function assertDataset() {
  if (retired)
    throw new Error(
      "Dataset replaced. Reload before continuing; older drafts remain recoverable.",
    );
}
export function ensureDataset(baseUrl: string): Promise<string> {
  initialized ??= fetch(`${baseUrl}/storage/status`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok)
        throw new Error("Could not connect to dataset storage.");
      const status = (await response.json()) as {
        generation: string;
        unavailable: boolean;
      };
      if (status.unavailable)
        throw new Error("Storage recovery required. Restart the backend.");
      generation = status.generation;
      return generation;
    })
    .catch((error: unknown) => {
      initialized = null;
      throw error;
    });
  return initialized;
}
export async function checkDataset(baseUrl: string) {
  const expected = await ensureDataset(baseUrl);
  const response = await fetch(`${baseUrl}/storage/status`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not check dataset identity.");
  const status = (await response.json()) as { generation: string };
  if (status.generation !== expected) retireDataset();
}
export function pendingDrafts(): boolean {
  try {
    const planner = sessionStorage.getItem(
      `deepblock.planner-draft.v2:${draftNamespace()}`,
    );
    if (
      planner &&
      Object.values(
        JSON.parse(planner) as Record<string, { operations?: unknown[] }>,
      ).some((draft) => draft.operations?.length)
    )
      return true;
    const prefix = `deepblock.note-draft.v2:${draftNamespace()}:`;
    for (let i = 0; i < sessionStorage.length; i++)
      if (sessionStorage.key(i)?.startsWith(prefix)) return true;
  } catch {
    /* Query-cache checks supplement storage when it is unavailable. */
  }
  return false;
}
const dirtyForms = new Set<string>();
export function setFormDirty(name: string, dirty: boolean) {
  if (dirty) dirtyForms.add(name);
  else dirtyForms.delete(name);
}
export function hasDirtyForms() {
  return dirtyForms.size > 0;
}
