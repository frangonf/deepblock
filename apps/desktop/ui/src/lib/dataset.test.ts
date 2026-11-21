import { beforeEach, describe, expect, it, vi } from "vitest";
describe("dataset identity and draft isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
  });
  it("keeps queued writes bound to the original generation after replacement", async () => {
    const module = await import("./dataset");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ generation: "original" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ generation: "replacement" }),
      });
    vi.stubGlobal("fetch", fetch);
    await module.ensureDataset("/api");
    sessionStorage.setItem(
      "deepblock.note-draft.v2:original:2026-01-05",
      "Retained",
    );
    expect(module.pendingDrafts()).toBe(true);
    await module.checkDataset("/api");
    expect(module.datasetGeneration()).toBe("original");
    expect(() => module.assertDataset()).toThrow("Dataset replaced");
    expect(
      sessionStorage.getItem("deepblock.note-draft.v2:original:2026-01-05"),
    ).toBe("Retained");
  });
  it("does not automatically attach legacy or other-dataset drafts", async () => {
    const module = await import("./dataset");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ generation: "new" }),
        }),
    );
    sessionStorage.setItem("deepblock.note-draft.v1:2026-01-05", "Legacy");
    sessionStorage.setItem("deepblock.note-draft.v2:old:2026-01-05", "Old");
    await module.ensureDataset("/api");
    expect(module.pendingDrafts()).toBe(false);
    expect(module.draftNamespace()).toBe("new");
    expect(sessionStorage.length).toBe(2);
  });
});
