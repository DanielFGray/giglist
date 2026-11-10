import { test as base, expect, type Locator, type Page } from "@playwright/test"

/** Password every seeded test user is registered with. Specs must not retype it. */
export const TEST_PASSWORD = "test_password_123!"

/** A user this test acts as. Its email is the one `testing/login` registers. */
export type TestUser = { readonly username: string; readonly email: string }

type TestingApi = {
  /**
   * The name `name` takes in this test: `name` (or `admin`) under a prefix
   * unique to the test. Every user a test makes or names must go through here,
   * so two tests running at once never share an account.
   */
  username(name?: string): string
  login(opts?: { username?: string; password?: string }): Promise<TestUser>
}

/** Find elements by data-pwid attribute, in a page or inside a part of one */
const getPw = (page: Page | Locator, name: string) =>
  page.locator(`[data-pwid=${name}]`)

/** Login through the UI */
const loginViaUi = async (
  page: Page,
  username: string,
  password: string,
) => {
  await page.goto("/login")
  await getPw(page, "login-id").fill(username)
  await getPw(page, "login-password").fill(password)
  await getPw(page, "login-submit").click()
  await expect(getPw(page, "dashboard")).toBeVisible({ timeout: 5000 })
}

/**
 * A fresh identity per test, not a shared database.
 *
 * Two tests used to be unable to run at once because they all acted as
 * `test_admin` and the fixture cleared every test row between tests. Now each
 * test names its users under a prefix of its own, so the suite is parallel and
 * no test reads or wipes another's rows. A run does not need the database to
 * itself either: the prefix carries a random token per worker process, so two
 * runs in the same checkout never mint the same user.
 *
 * The prefix stays short on purpose: the username domain allows 64 characters,
 * so a long run id would leave little room for the name a call site asks for.
 *
 * `bun run test:clean` removes these users between runs. Nothing removes them
 * automatically, because that is what used to delete one run's rows out from
 * under another.
 */
const run = Math.random().toString(36).slice(2, 8)
let identities = 0

export const test = base.extend<{ testing: TestingApi }>({
  testing: [async ({ page }, use, testInfo) => {
    const prefix = `test_${run}_w${testInfo.parallelIndex}_${++identities}`
    const testing: TestingApi = {
      username: (name = "admin") => `${prefix}_${name}`,

      async login(opts = {}) {
        const username = testing.username(opts.username)
        const res = await page.request.post("/api/testing/login", {
          data: { username, password: opts.password ?? TEST_PASSWORD },
        })
        expect(res.ok(), `testing/login failed: ${await res.text()}`).toBe(
          true,
        )
        // The endpoint answers 200 even when it could not create the session,
        // and it reports why in `message`; the HTTP status alone proves nothing.
        const body = (await res.json()) as { success?: boolean; message?: string }
        expect(
          body.success,
          `testing/login reported failure: ${body.message ?? "no reason given"}`,
        ).toBe(true)
        return { username, email: `${username}@test.local` }
      },
    }

    await use(testing)
  }, { auto: true }],
})

const pasted = "[Verse 1]\nG        C\nAmazing grace, how sweet"

/** POSTs `data` as JSON and returns the parsed answer, failing the test on an error status. */
export const post = async (page: Page, url: string, data: unknown) => {
  const res = await page.request.post(url, { data })
  expect(res.ok(), `${url} failed: ${await res.text()}`).toBe(true)
  return res.json()
}

/**
 * A gig "Friday" that plays two setlists: "Set 1" (Alpha, then Beta in its entry key of Bb)
 * and "Encore" (Gamma). Beta has a chart with a mark and the notes "Watch the break".
 */
export const createGig = async (page: Page) => {
  const band = await post(page, "/api/my/bands", { slug: `test-perform-${crypto.randomUUID().slice(0, 8)}`, name: "Test: perform" })
  const song = (title: string, key: string) =>
    post(page, "/api/songs", { band_id: band.id, title, artist: null, key, tempo_bpm: 120, duration_seconds: null, capo: null, notes: title === "Beta" ? "Watch the break" : null })
  const [alpha, beta, gamma] = [await song("Alpha", "G"), await song("Beta", "G"), await song("Gamma", "D")]
  const chart = await post(page, "/api/charts", { song_id: beta.id, name: "Chords", written_key: "G", pasted })
  await post(page, "/api/marks", {
    revision_id: chart.revision_id, scope: { kind: "chart" }, range_start: 1, range_end: 8, side: "inline",
    dx: 0, dy: 1, scale: 1, body: { kind: "text", text: "tacet" }, visibility: "private",
  })
  const setlist = async (name: string, songs: ReadonlyArray<{ id: string }>) => {
    const created = await post(page, "/api/setlists", { band_id: band.id, name })
    const entries = []
    for (const s of songs) entries.push(await post(page, `/api/setlists/${created.id}/entries`, { song_id: s.id }))
    return { id: created.id as string, entries }
  }
  const [one, encore] = [await setlist("Set 1", [alpha, beta]), await setlist("Encore", [gamma])]
  const override = await page.request.put(`/api/setlists/${one.id}/entries/${one.entries[1].id}`, { data: { key_override: "Bb" } })
  expect(override.ok(), await override.text()).toBe(true)
  const gig = await post(page, "/api/gigs", {
    band_id: band.id, venue: "Friday", gig_date: null, address: null, load_in_time: null, performance_time: null, notes: null,
  })
  for (const s of [one, encore]) await post(page, `/api/gigs/${gig.id}/setlists`, { setlist_id: s.id })
  return { bandId: band.id as string, gigId: gig.id as string, setlistId: one.id, encoreId: encore.id }
}

/** A new band with one song, "Amazing Grace" in G, at `tempo` beats per minute or none. */
export const createSong = async (page: Page, tempo: number | null = null) => {
  const bandRes = await page.request.post("/api/my/bands", {
    data: { slug: `test-charts-${crypto.randomUUID().slice(0, 8)}`, name: "Test: charts" },
  })
  expect(bandRes.ok(), `create band failed: ${await bandRes.text()}`).toBe(true)
  const bandId = (await bandRes.json()).id as string
  const songRes = await page.request.post("/api/songs", {
    data: { band_id: bandId, title: "Amazing Grace", artist: null, key: "G", tempo_bpm: tempo, duration_seconds: null, capo: null, notes: null },
  })
  expect(songRes.ok(), `create song failed: ${await songRes.text()}`).toBe(true)
  return { bandId, songId: (await songRes.json()).id as string }
}

/** A lyrics chart on `songId` with one verse of two lines and no chords. */
export const createBareChart = async (page: Page, songId: string) => {
  const res = await page.request.post("/api/charts", {
    data: { song_id: songId, name: "Words", written_key: "G", pasted: "[Verse 1]\nAmazing grace, how sweet\nThe sound" },
  })
  expect(res.ok(), `create chart failed: ${await res.text()}`).toBe(true)
  return (await res.json()) as { id: string; revision_id: string }
}

/** Turns annotate mode on if it is off, then arms a mark tool. */
export const openTool = async (page: Page, tool: "move" | "ink" | "text" | "stamp") => {
  const annotate = getPw(page, "chart-annotate")
  if ((await annotate.getAttribute("aria-pressed")) !== "true") await annotate.click()
  await getPw(page, `tool-${tool}`).click()
}

export { expect, getPw, loginViaUi }
