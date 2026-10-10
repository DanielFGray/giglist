import { defineConfig } from "@playwright/test"

// Browser-facing URL (the Vite dev server). Playwright loads .env for us.
const BASE_URL = process.env.VITE_ROOT_URL ?? "http://localhost:3001"

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  fullyParallel: false,
  // One worker only: every spec shares a single database, and
  // `/api/testing/clear` deletes bands by name pattern, so a worker running
  // another spec would wipe a band the active spec just created.
  workers: 1,
  retries: 1,
  timeout: 15000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: {
    command: "bun run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60000,
  },
})
