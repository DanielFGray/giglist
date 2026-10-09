/**
 * Global setup: clears all test data before the test suite runs.
 * Ensures a clean slate regardless of how previous runs ended.
 */
import { BASE_URL } from "./baseUrl"

export default async function globalSetup() {
  const res = await fetch(`${BASE_URL}/api/testing/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  if (!res.ok) {
    throw new Error(`Global setup: failed to clear test data: ${await res.text()}`)
  }
}
