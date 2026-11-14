import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Two projects, one runner. `unit` runs every other test file and needs no
// database, so `scripts/verify` can run it on an exported tree. `api` runs the
// `*.api.test.ts` files in-process against the `_test` database (globalSetup).
// Playwright runs `tests/`. Each project extends this file, so both resolve the
// `~/` alias that tsconfig.json maps to src/.
export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "worker/**/*.test.{ts,mjs}"],
          exclude: ["**/node_modules/**", "**/*.api.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "api",
          include: ["src/**/*.api.test.ts"],
          globalSetup: ["./src/server/test/globalSetup.ts"],
          setupFiles: ["./src/server/test/setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
})
