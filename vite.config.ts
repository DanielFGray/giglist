import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

if (!process.env.VITE_ROOT_URL) {
  throw new Error("VITE_ROOT_URL environment variable is not defined");
}
// `host` from URL includes the port ("localhost:3001"); Vite needs the bare
// hostname, so take `hostname`.
const { port, hostname } = new URL(process.env.VITE_ROOT_URL);

// The browser talks to Vite on VITE_ROOT_URL; the Effect API server listens on
// PORT. Proxying /api to Vite's own port would loop back to the SPA.
const API_PORT = process.env.PORT ?? "3000";

export default defineConfig({
  server: {
    port: Number(port),
    host: hostname,
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
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
    react(),
  ],
});
