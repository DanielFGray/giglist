import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { alphaTabAssetsPlugin } from "./scripts/alphaTabAssetsPlugin";
import { licenseNoticesPlugin } from "./scripts/licenseNoticesPlugin";
import path from "node:path";

// `host` from URL includes the port ("localhost:3001"); Vite needs the bare
// hostname, so take `hostname`. HOST overrides it to listen on another
// interface, e.g. `HOST=0.0.0.0 bun run dev` to reach the app over Tailscale.
const { port, hostname } = new URL(process.env.VITE_ROOT_URL ?? "http://localhost:3001");
const host = process.env.HOST ?? hostname;

// The browser talks to Vite on VITE_ROOT_URL; the Effect API server listens on
// PORT. Proxying /api to Vite's own port would loop back to the SPA.
const API_PORT = process.env.PORT ?? "3000";

const apiProxy = {
  "/api": {
    target: `http://localhost:${API_PORT}`,
    changeOrigin: true,
  },
};

export default defineConfig({
  server: {
    port: Number(port),
    host,
    // Vite rejects requests whose Host header it does not know. IP addresses
    // and localhost always pass; this adds Tailscale MagicDNS names.
    allowedHosts: [".ts.net"],
    proxy: apiProxy,
  },
  // `vite preview` serves the built bundle, and the tests run against it: a
  // page load there skips the dev server's per-module transforms, which cost
  // more than the test itself.
  preview: {
    port: Number(process.env.PREVIEW_PORT ?? 4173),
    host,
    proxy: apiProxy,
  },
  // alphaTab starts its own workers from URLs; keep Vite from pre-bundling it.
  optimizeDeps: { exclude: ["@coderline/alphatab"] },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
    },
  },
  plugins: [
    // Reads tsr.config.json, which scripts/generateRouteTree.ts reads too.
    TanStackRouterVite(),
    tailwindcss(),
    alphaTabAssetsPlugin(),
    licenseNoticesPlugin(),
    react(),
  ],
});
