import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

/** Create a band for the logged-in user and return its id. The song page needs
 *  a current band, and the root loader picks bands[0]. */
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

test.describe("songs", () => {
  test("adds, edits and deletes a song", async ({ page, testing }) => {
    await testing.login()
    await createBand(page, `test-songs-crud-${Date.now()}`)

    await page.goto("/songs")
    await expect(getPw(page, "songs-empty")).toBeVisible({ timeout: 10000 })

    await getPw(page, "song-title").fill("Wonderwall")
    await getPw(page, "song-artist").fill("Oasis")
    // The key is a select of the keys the database's domain accepts, so the
    // form cannot send a value the schema will refuse.
    await getPw(page, "song-key").selectOption("Em")
    await getPw(page, "song-tempo").fill("87")
    await getPw(page, "song-submit").click()

    await expect(getPw(page, "song-row")).toHaveCount(1, { timeout: 10000 })
    await expect(getPw(page, "song-row-title")).toHaveText("Wonderwall")

    await getPw(page, "song-edit").click()
    await getPw(page, "song-tempo").fill("92")
    await getPw(page, "song-submit").click()

    await expect(getPw(page, "song-row")).toContainText("92 BPM", { timeout: 10000 })

    await getPw(page, "song-delete").click()
    await expect(getPw(page, "songs-empty")).toBeVisible({ timeout: 10000 })
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
