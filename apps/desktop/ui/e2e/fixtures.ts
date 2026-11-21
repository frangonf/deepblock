import { test as base } from "@playwright/test";
export * from "@playwright/test";
export const test = base.extend<{ mutationRuntime: void }>({
  mutationRuntime: [async ({ context }, provide) => {
    const activeMutant = process.env.__STRYKER_ACTIVE_MUTANT__;
    if (process.env.DEEPBLOCK_MUTATION_E2E === '1' && activeMutant !== undefined) {
      // Stryker's command runner passes this through Node's environment. Browsers
      // need the same namespace before the first application module executes.
      await context.addInitScript((id) => {
        (globalThis as typeof globalThis & { __stryker__?: { activeMutant: string } })
          .__stryker__ = { activeMutant: id };
      }, activeMutant);
    }
    await provide();
  }, { auto: true }],
  request: async ({ playwright }, provide) => {
    const probe = await playwright.request.newContext();
    const response = await probe.get("http://127.0.0.1:8010/storage/status");
    const status = (await response.json()) as { generation: string };
    await probe.dispose();
    const context = await playwright.request.newContext({
      extraHTTPHeaders: { "x-deepblock-dataset-generation": status.generation },
    });
    await provide(context);
    await context.dispose();
  },
});
