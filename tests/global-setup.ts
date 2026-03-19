/**
 * Global setup: clears all test data before the test suite runs.
 * Ensures a clean slate regardless of how previous runs ended.
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"

export default async function globalSetup() {
  const res = await fetch(`${BASE_URL}/api/testing/clear`, { method: "POST" })
  if (!res.ok) {
    throw new Error(`Global setup: failed to clear test data: ${await res.text()}`)
  }
}
