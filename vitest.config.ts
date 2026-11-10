import { defineConfig } from "vitest/config"

// The API suite only: `*.api.test.ts` files call the server in-process against
// the `_test` database. `bun test` runs the other `*.test.ts` files, and
// Playwright runs `tests/`.
export default defineConfig({
  test: {
    include: ["src/**/*.api.test.ts"],
    globalSetup: ["./src/server/test/globalSetup.ts"],
    setupFiles: ["./src/server/test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 300_000,
  },
})
