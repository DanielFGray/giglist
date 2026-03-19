import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 1,
  timeout: 15000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: {
    command: "bun dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30000,
  },
})
