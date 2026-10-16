import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { alphaTabAssetsPlugin } from "./scripts/alphaTabAssetsPlugin";
import path from "node:path";

if (!process.env.VITE_ROOT_URL) {
  throw new Error("VITE_ROOT_URL environment variable is not defined");
}
// `host` from URL includes the port ("localhost:3001"); Vite needs the bare
// hostname, so take `hostname`. HOST overrides it to listen on another
// interface, e.g. `HOST=0.0.0.0 bun run dev` to reach the app over Tailscale.
const { port, hostname } = new URL(process.env.VITE_ROOT_URL);
const host = process.env.HOST ?? hostname;

// The browser talks to Vite on VITE_ROOT_URL; the Effect API server listens on
// PORT. Proxying /api to Vite's own port would loop back to the SPA.
const API_PORT = process.env.PORT ?? "3000";

export default defineConfig({
  server: {
    port: Number(port),
    host,
    // Vite rejects requests whose Host header it does not know. IP addresses
    // and localhost always pass; this adds Tailscale MagicDNS names.
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  // alphaTab starts its own workers from URLs; keep Vite from pre-bundling it.
  optimizeDeps: { exclude: ["@coderline/alphatab"] },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
    },
  },
  plugins: [
    TanStackRouterVite({
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
    }),
    tailwindcss(),
    alphaTabAssetsPlugin(),
    react(),
  ],
});
