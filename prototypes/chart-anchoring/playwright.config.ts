import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:4410" },
  webServer: { command: "bun server.ts", url: "http://localhost:4410", reuseExistingServer: true },
});
