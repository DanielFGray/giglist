import { test as base, expect, type Page } from "@playwright/test"

/** Password every seeded test user is registered with. Specs must not retype it. */
export const TEST_PASSWORD = "test_password_123!"

type TestUser = {
  id: string
  username: string
  email: string
  name: string
}

type TestingApi = {
  login(opts?: {
    username?: string
    password?: string
    email?: string
    name?: string
  }): Promise<TestUser>
  clear(): Promise<void>
}

/** Find elements by data-pwid attribute */
const getPw = (page: Page, name: string) =>
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

// `auto`: every test starts from a cleared database even when it never names the fixture.
export const test = base.extend<{ testing: TestingApi }>({
  testing: [async ({ page }, use) => {
    const testing: TestingApi = {
      async login(opts = {}) {
        const res = await page.request.post("/api/testing/login", {
          data: { username: "test_admin", password: TEST_PASSWORD, ...opts },
        })
        expect(res.ok(), `testing/login failed: ${await res.text()}`).toBe(
          true,
        )
        // The endpoint answers 200 even when it could not create the session,
        // so the HTTP status alone is not evidence of a logged-in browser.
        const body = (await res.json()) as { success?: boolean }
        expect(body.success, "testing/login reported failure").toBe(true)
        return res.json()
      },

      async clear() {
        const res = await page.request.post("/api/testing/clear")
        expect(res.ok(), `testing/clear failed: ${await res.text()}`).toBe(
          true,
        )
        // Clear browser cookies after DB cleanup
        await page.context().clearCookies()
      },
    }

    await testing.clear()
    await use(testing)
  }, { auto: true }],
})

const pasted = "[Verse 1]\nG        C\nAmazing grace, how sweet"

/** A setlist of three songs, "Set 1" holding the first two and "Encore" the last; the second song has a chart, a mark and an entry key of Bb. */
export const createSetlist = async (page: Page) => {
  const post = async (url: string, data: unknown) => {
    const res = await page.request.post(url, { data })
    expect(res.ok(), `${url} failed: ${await res.text()}`).toBe(true)
    return res.json()
  }
  const band = await post("/api/my/bands", { slug: `test-perform-${Date.now()}`, name: "Test: perform" })
  const song = (title: string, key: string | null) =>
    post("/api/songs", { band_id: band.id, title, artist: null, key, tempo_bpm: 120, duration_seconds: null, capo: null, notes: title === "Beta" ? "Watch the break" : null })
  const [alpha, beta, gamma] = [await song("Alpha", "G"), await song("Beta", "G"), await song("Gamma", "D")]
  const chart = await post("/api/charts", { song_id: beta.id, name: "Chords", written_key: "G", pasted })
  await post("/api/marks", {
    revision_id: chart.revision_id, scope: { kind: "chart" }, range_start: 1, range_end: 8, side: "inline",
    dx: 0, dy: 1, scale: 1, body: { kind: "text", text: "tacet" }, visibility: "private",
  })
  const setlist = await post("/api/setlists", { band_id: band.id, name: "Friday", description: null, gig_date: null, status: "draft" })
  const [one, encore] = [await post(`/api/setlists/${setlist.id}/sections`, { name: "Set 1" }), await post(`/api/setlists/${setlist.id}/sections`, { name: "Encore" })]
  const entries = []
  for (const s of [alpha, beta, gamma]) {
    entries.push(await post(`/api/setlists/${setlist.id}/entries`, { song_id: s.id }))
  }
  const betaEntry = entries[1]
  const override = await page.request.put(`/api/setlists/${setlist.id}/entries/${betaEntry.id}`, {
    data: { section_id: null, key_override: "Bb", tempo_override: null, notes_override: null },
  })
  expect(override.ok(), await override.text()).toBe(true)
  for (const move of [
    { kind: "entry", id: entries[0].id, section_id: one.id, previous: null },
    { kind: "entry", id: entries[1].id, section_id: one.id, previous: entries[0].id },
    { kind: "entry", id: entries[2].id, section_id: encore.id, previous: null },
  ] as const) {
    const moved = await page.request.put(`/api/setlists/${setlist.id}/move`, { data: move })
    expect(moved.ok(), await moved.text()).toBe(true)
  }
  return { bandId: band.id as string, setlistId: setlist.id as string }
}

/** Turns annotate mode on if it is off, then arms a mark tool. */
export const openTool = async (page: Page, tool: "move" | "ink" | "text" | "stamp") => {
  const annotate = getPw(page, "chart-annotate")
  if ((await annotate.getAttribute("aria-pressed")) !== "true") await annotate.click()
  await getPw(page, `tool-${tool}`).click()
}

export { expect, getPw, loginViaUi }
