import { defineConfig } from "@playwright/test";

/**
 * Committed but not wired into CI. See e2e/happy-path.spec.ts for why, and the README
 * for what was deliberately left out of this project.
 *
 * Running it needs a real ANTHROPIC_API_KEY and a seeded database, because the mock AI
 * layer was removed from application code — test scaffolding does not belong in the
 * shipping path.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
