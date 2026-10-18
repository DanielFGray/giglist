import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

/** Create a band for the logged-in user and return its id. Band-scoped routes
 *  carry the id in the path, so a song spec needs one before it can deep-link. */
const createBand = async (
  page: import("@playwright/test").Page,
  slug: string,
) => {
  const res = await page.request.post("/api/my/bands", {
    data: { slug, name: `Test: ${slug}` },
  })
  expect(res.ok(), `create band failed: ${await res.text()}`).toBe(true)
  const band = await res.json()
  return band.id as string
}

/** The session cookie from a response, shaped as a request header value. */
const cookieOf = (res: import("@playwright/test").APIResponse) =>
  res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value.split(";")[0])
    .join("; ")

/** Add a song straight through the API, for specs that only exercise the list. */
const createSong = async (
  page: import("@playwright/test").Page,
  bandId: string,
  song: { title: string; artist: string; tempo_bpm: number },
) => {
  const res = await page.request.post("/api/songs", {
    data: {
      band_id: bandId,
      title: song.title,
      artist: song.artist,
      key: null,
      tempo_bpm: song.tempo_bpm,
      duration_seconds: null,
      capo: null,
      notes: null,
    },
  })
  expect(res.ok(), `create song failed: ${await res.text()}`).toBe(true)
}

test.describe("songs", () => {
  test("adds a song with every metadata field", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-songs-metadata-${Date.now()}`)

    await page.goto(`/band/${bandId}/songs`)
    await expect(getPw(page, "songs-empty")).toBeVisible({ timeout: 10000 })

    await getPw(page, "song-new").click()
    await expect(getPw(page, "song-form")).toBeVisible({ timeout: 10000 })
    await getPw(page, "song-title").fill("Wonderwall")
    await getPw(page, "song-artist").fill("Oasis")
    // The key is a select of the keys the database's domain accepts, so the
    // form cannot send a value the schema will refuse.
    await getPw(page, "song-key").selectOption("Em")
    await getPw(page, "song-tempo").fill("87")
    await getPw(page, "song-duration").fill("4:18")
    await getPw(page, "song-capo").fill("2")
    await getPw(page, "song-notes").fill("Capo 2, strummed")
    await getPw(page, "song-submit").click()

    // Saving opens the new song's page; the list shows what the form collected.
    await expect(getPw(page, "song-edit-form")).toBeVisible({ timeout: 10000 })
    await page.goto(`/band/${bandId}/songs`)
    await expect(getPw(page, "song-row")).toHaveCount(1, { timeout: 10000 })
    await expect(getPw(page, "song-row-title")).toHaveText("Wonderwall")
    // The row carries the fields the form collected, duration as mm:ss.
    await expect(getPw(page, "song-row-meta")).toContainText("Em")
    await expect(getPw(page, "song-row-meta")).toContainText("87 BPM")
    await expect(getPw(page, "song-row-meta")).toContainText("4:18")
    await expect(getPw(page, "song-row-meta")).toContainText("capo 2")
    await expect(getPw(page, "song-row-notes")).toHaveText("Capo 2, strummed")
  })

  test("edits and deletes a song", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-songs-crud-${Date.now()}`)
    await createSong(page, bandId, { title: "Everlong", artist: "Foo Fighters", tempo_bpm: 158 })

    await page.goto(`/band/${bandId}/songs`)
    await expect(getPw(page, "song-row")).toHaveCount(1, { timeout: 10000 })

    await getPw(page, "song-edit").click()
    await expect(getPw(page, "song-edit-form")).toBeVisible({ timeout: 10000 })
    await getPw(page, "song-tempo").fill("92")
    await getPw(page, "song-duration").fill("4:05")
    await getPw(page, "song-submit").click()

    await expect(getPw(page, "song-row-meta")).toContainText("92 BPM", { timeout: 10000 })
    await expect(getPw(page, "song-row-meta")).toContainText("4:05")

    await getPw(page, "song-edit").click()
    await expect(getPw(page, "song-edit-form")).toBeVisible({ timeout: 10000 })
    await getPw(page, "song-delete").click()
    await expect(getPw(page, "songs-empty")).toBeVisible({ timeout: 10000 })
  })

  test("rejects a duration that is not mm:ss", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-songs-duration-${Date.now()}`)

    await page.goto(`/band/${bandId}/songs/new`)
    await getPw(page, "song-title").fill("Bad Duration")
    await getPw(page, "song-duration").fill("nope")

    await expect(getPw(page, "song-duration-error")).toBeVisible({ timeout: 5000 })
    // The invalid value blocks submission, so it can never reach the API.
    await expect(getPw(page, "song-submit")).toBeDisabled()
    await expect(getPw(page, "song-form")).toBeVisible()
  })

  test("the add page shows the sections of the edit page", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-songs-parity-${Date.now()}`)

    await page.goto(`/band/${bandId}/songs/new`)
    await expect(getPw(page, "song-form")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "song-charts")).toBeVisible()
    await expect(getPw(page, "chart-add")).toBeDisabled()
    await expect(getPw(page, "song-delete")).toBeDisabled()

    await createSong(page, bandId, { title: "Parity", artist: "The Sames", tempo_bpm: 100 })
    await page.goto(`/band/${bandId}/songs`)
    await getPw(page, "song-edit").click()
    await expect(getPw(page, "song-edit-form")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "song-charts")).toBeVisible()
    await expect(getPw(page, "chart-add")).toBeEnabled()
    await expect(getPw(page, "song-delete")).toBeEnabled()
  })

  test("a new song opens its own page, where charts can be added", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-songs-parity-${Date.now()}`)

    await page.goto(`/band/${bandId}/songs/new`)
    await expect(getPw(page, "song-form")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "song-charts")).toBeVisible()
    await expect(getPw(page, "chart-add")).toBeDisabled()
    await expect(getPw(page, "song-delete")).toBeDisabled()

    await getPw(page, "song-title").fill("Parity")
    await getPw(page, "song-submit").click()

    // The saved song's page has the same sections, now usable.
    await expect(getPw(page, "song-edit-form")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "song-charts")).toBeVisible()
    await expect(getPw(page, "chart-add")).toBeEnabled()
    await expect(getPw(page, "song-delete")).toBeEnabled()
  })

  test("sorts and searches the catalog", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-songs-filter-${Date.now()}`)
    await createSong(page, bandId, { title: "Zebra", artist: "The Zeds", tempo_bpm: 90 })
    await createSong(page, bandId, { title: "Apple", artist: "The As", tempo_bpm: 140 })
    await createSong(page, bandId, { title: "Mango", artist: "The Ms", tempo_bpm: 120 })

    await page.goto(`/band/${bandId}/songs`)
    await expect(getPw(page, "song-row")).toHaveCount(3, { timeout: 10000 })

    await getPw(page, "songs-sort").selectOption("title")
    await expect(getPw(page, "song-row-title").first()).toHaveText("Apple")

    await getPw(page, "songs-sort").selectOption("tempo")
    await expect(getPw(page, "song-row-title").first()).toHaveText("Zebra")

    await getPw(page, "songs-search").fill("mang")
    await expect(getPw(page, "song-row")).toHaveCount(1, { timeout: 5000 })
    await expect(getPw(page, "song-row-title")).toHaveText("Mango")

    await getPw(page, "songs-search").fill("nothing matches this")
    await expect(getPw(page, "songs-no-match")).toBeVisible({ timeout: 5000 })
  })

  test("refuses a user who is not a member of the band", async ({
    page,
    testing,
    request,
  }) => {
    await testing.login()
    const bandId = await createBand(page, `test-songs-authz-${Date.now()}`)

    // A second user, in its own cookie store, must not reach the first band.
    const username = `test_song_outsider_${Date.now()}`
    const registered = await request.post("/api/auth/register", {
      data: {
        username,
        email: `${username}@test.local`,
        password: TEST_PASSWORD,
      },
    })
    expect(registered.ok(), await registered.text()).toBe(true)

    const listing = await request.get(`/api/songs/band/${bandId}`)
    expect(listing.status(), `outsider read the song list`).toBe(403)

    const write = await request.post("/api/songs", {
      data: {
        band_id: bandId,
        title: "Injected",
        artist: null,
        key: null,
        tempo_bpm: null,
        duration_seconds: null,
        capo: null,
        notes: null,
      },
    })
    expect(write.status(), "outsider wrote into another band's catalog").toBe(403)
  })

  test("a user with no bands sees no bands at all", async ({
    page,
    testing,
    request,
  }) => {
    // Someone else owns a band, so there is data a leak would surface.
    await testing.login()
    await createBand(page, `test-rls-other-${Date.now()}`)

    // A fresh user, logged in through the API so its cookie is separate from
    // the page's. Before RLS was enforced this list returned every band in the
    // database rather than only the user's own.
    const username = `test_rls_empty_${Date.now()}`
    await request.post("/api/auth/register", {
      data: {
        username,
        email: `${username}@test.local`,
        password: TEST_PASSWORD,
      },
    })
    const login = await request.post("/api/auth/login", {
      data: { id: username, password: TEST_PASSWORD },
    })
    expect(login.ok(), await login.text()).toBe(true)

    const bands = await request.get("/api/my/bands", {
      headers: { cookie: cookieOf(login) },
    })
    expect(bands.status()).toBe(200)
    expect(
      await bands.json(),
      "a user with no bands saw another user's bands",
    ).toEqual([])
  })
})
