/**
 * Browser-facing URL for the test suite: the built client on `vite preview`,
 * which Playwright drives, and whose proxy forwards /api to the Effect API
 * server. Kept in one place so config, helpers and specs cannot drift apart.
 */
export const BASE_URL = process.env.VITE_ROOT_URL ?? "http://localhost:4173"
