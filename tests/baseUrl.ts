/**
 * Browser-facing URL for the test suite. This is the Vite dev server, which
 * Playwright drives; Vite forwards /api through to the Effect API server.
 * Kept in one place so config, helpers and specs cannot drift apart.
 */
export const BASE_URL = process.env.VITE_ROOT_URL ?? "http://localhost:3001"