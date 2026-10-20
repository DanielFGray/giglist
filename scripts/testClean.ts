/**
 * Deletes the users and bands the Playwright suite created.
 *
 * The suite names its rows `test_*` and leaves them behind on purpose: a run
 * must not delete a concurrent run's fixtures. Run this when no test run is
 * active and the dev database has collected enough of them.
 *
 * It talks to the API directly, so it needs no client (and no proxy) running.
 */
const api = `http://localhost:${process.env.PORT ?? "3010"}`

const res = await fetch(`${api}/api/testing/clear`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
})
if (!res.ok) {
  console.error(`test:clean failed (${res.status}): ${await res.text()}`)
  process.exit(1)
}
console.log(`test:clean removed the test rows through ${api}.`)

export {}
