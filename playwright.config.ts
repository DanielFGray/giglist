import { defineConfig } from "@playwright/test"
import { BASE_URL } from "./tests/baseUrl"

/** Where `src/server/main.ts` listens. The client proxies `/api` here. */
const API_PORT = process.env.PORT ?? "3010"

export default defineConfig({
  testDir: "./tests",
  // Tests run in parallel because each one owns an identity, not the database:
  // the fixture names its users `test_<run>_w<worker>_<n>`, with a token per
  // worker process, so no two tests in a run and no two runs share a user.
  // The suite drives the built client on `vite preview`; a dev-mode page load
  // transforms every module on demand and costs more than the test around it
  // (6.3s per trivial test at four workers, against 1.6s on the bundle).
  fullyParallel: true,
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 4),
  retries: process.env.CI ? 1 : 0,
  // Generous, because several pages render a score with alphaTab on the client
  // and four browsers share the CPU. A test that is merely slow must not read
  // as a failure; one that is wrong still fails on its assertion.
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  // Two servers, because they scale apart: the API is shared by every worker,
  // while the client is a static bundle that a build has to produce first.
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : [
        {
          command: "bun run dev:server",
          // The specs register more users per hour than a person would.
          env: { RATE_LIMIT: "off" },
          url: `http://localhost:${API_PORT}/api/health`,
          reuseExistingServer: true,
          timeout: 60000,
        },
        {
          command: "bun run test:client",
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 180000,
        },
      ],
})
