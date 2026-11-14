import type { Page } from "@playwright/test"
import { test, expect, getPw, TEST_PASSWORD, testSlug } from "./helpers"

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
  return (await res.json()).id as string
}

/** The catalog grid's rows, and one column of them. */
const rows = (page: Page) => getPw(page, "grid-row")
const column = (page: Page, key: string) => rows(page).locator(`[data-pwid="cell-${key}"]`)
const newTitle = (page: Page) => getPw(page, "grid-new-row").locator('[data-pwid="cell-title"]')

test.describe("songs", () => {
  test("types a run of titles into the last row, then fills in the artists down the column", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-grid"))

    await page.goto(`/band/${bandId}/songs`)
    await newTitle(page).click()
    for (const title of ["Roadhouse Blues", "Hey Joe", "Gloria"]) {
      await page.keyboard.type(title)
      await page.keyboard.press("Enter")
      // Enter in the last row adds the song and stays there for the next one.
      await expect(column(page, "title").last()).toHaveText(title)
    }
    await expect(column(page, "title")).toHaveText(["Roadhouse Blues", "Hey Joe", "Gloria"])

    // Back to the top, one step right, and down the artist column.
    await page.keyboard.press("Control+Home")
    await page.keyboard.press("ArrowRight")
    for (const artist of ["The Doors", "Jimi Hendrix", "Them"]) {
      await page.keyboard.type(artist)
      await page.keyboard.press("Enter")
    }
    await expect(column(page, "artist")).toHaveText(["The Doors", "Jimi Hendrix", "Them"])
    await expect(column(page, "artist").last()).toHaveAttribute("aria-busy", "false")

    // The rows are saved, and keep the order they were typed in.
    await page.reload()
    await expect(column(page, "title")).toHaveText(["Roadhouse Blues", "Hey Joe", "Gloria"], { timeout: 10000 })
    await expect(column(page, "artist")).toHaveText(["The Doors", "Jimi Hendrix", "Them"])
  })

  test("an edited cell keeps the typed artist until the page renders the saved row", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-pending"))
    await createSong(page, bandId, { title: "Seven Nation Army", artist: "The White Stripes", tempo_bpm: 124 })

    await page.goto(`/band/${bandId}/songs`)
    const cell = column(page, "artist").first()
    await expect(cell).toHaveText("The White Stripes", { timeout: 10000 })

    // Every text the cell takes, with the time it took it, so a flash of the
    // old value between the save settling and the page rendering shows up.
    await cell.evaluate((element) => {
      const seen: Array<{ t: number; text: string }> = []
      ;(window as unknown as { seenArtistTexts: typeof seen }).seenArtistTexts = seen
      new MutationObserver(() => seen.push({ t: performance.now(), text: element.textContent ?? "" })).observe(
        element,
        { subtree: true, childList: true, characterData: true },
      )
    })

    await cell.click()
    await page.keyboard.type("Aretha Franklin")
    await page.keyboard.press("Enter")
    await expect(cell).toHaveText("Aretha Franklin")
    await expect(cell).toHaveAttribute("aria-busy", "false")

    const seen = await page.evaluate(
      () => (window as unknown as { seenArtistTexts: Array<{ t: number; text: string }> }).seenArtistTexts,
    )
    const firstNew = seen.findIndex((entry) => entry.text === "Aretha Franklin")
    expect(firstNew, `the observer never saw the new artist: ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(0)
    const flashed = seen.slice(firstNew).filter((entry) => entry.text === "The White Stripes")
    expect(flashed, `the old artist flashed back after the new one: ${JSON.stringify(seen)}`).toEqual([])
  })

  test("Tab saves a cell and moves along the row; Escape cancels and Delete clears", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-tab"))

    await page.goto(`/band/${bandId}/songs`)
    await newTitle(page).click()
    await page.keyboard.type("Wonderwall")
    await page.keyboard.press("Tab")
    // Tab from the new row's title goes on along that row at once: typing does
    // not wait for the song to be created, and no keystroke is lost meanwhile.
    for (const value of ["Oasis", "em", "87", "4:18", "2", "Capo 2, strummed"]) {
      await page.keyboard.type(value)
      await page.keyboard.press("Tab")
    }
    const cells = () => rows(page).first().locator("td")
    // The key column offers the keys that match what was typed, and Tab takes the first.
    await expect(cells()).toHaveText(["Wonderwall", "Oasis", "Em", "87", "4:18", "2", "Capo 2, strummed", /Charts/])

    await column(page, "tempo").click()
    await page.keyboard.type("120")
    await page.keyboard.press("Escape")
    await expect(column(page, "tempo")).toHaveText("87")

    await page.keyboard.press("Delete")
    await expect(column(page, "tempo")).toHaveText("")
    await expect(column(page, "tempo")).toHaveAttribute("aria-busy", "false")
    await page.reload()
    await expect(column(page, "tempo")).toHaveText("", { timeout: 10000 })
    await expect(column(page, "duration")).toHaveText("4:18")
  })

  test("refuses a bad value in a cell and says why", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-bad"))
    await createSong(page, bandId, { title: "Everlong", artist: "Foo Fighters", tempo_bpm: 158 })

    await page.goto(`/band/${bandId}/songs`)
    await column(page, "tempo").click()
    await page.keyboard.type("fast")
    await page.keyboard.press("Enter")
    await expect(getPw(page, "songs-grid-error")).toHaveText("Tempo is a whole number from 1 to 999")
    await expect(column(page, "tempo")).toHaveText("158")

    await column(page, "duration").click()
    await page.keyboard.type("nope")
    await page.keyboard.press("Enter")
    await expect(getPw(page, "songs-grid-error")).toHaveText("Length is minutes:seconds, like 3:45")

    await column(page, "title").click()
    await page.keyboard.press("Delete")
    await expect(getPw(page, "songs-grid-error")).toHaveText("A song needs a title")
    await expect(column(page, "title")).toHaveText("Everlong")
  })

  test("deletes a song from its row", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-delete"))
    await createSong(page, bandId, { title: "Everlong", artist: "Foo Fighters", tempo_bpm: 158 })

    await page.goto(`/band/${bandId}/songs`)
    await expect(rows(page)).toHaveCount(1, { timeout: 10000 })
    await getPw(page, "song-delete").click()
    await expect(rows(page)).toHaveCount(0, { timeout: 10000 })
  })

  test("a sort is applied when asked: an edited row keeps its place until the next sort", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-stable"))
    await createSong(page, bandId, { title: "Apple", artist: "The As", tempo_bpm: 140 })
    await createSong(page, bandId, { title: "Mango", artist: "The Ms", tempo_bpm: 120 })

    await page.goto(`/band/${bandId}/songs?sort=title`)
    await expect(column(page, "title")).toHaveText(["Apple", "Mango"], { timeout: 10000 })
    await column(page, "title").first().click()
    await page.keyboard.type("Zucchini")
    await page.keyboard.press("Enter")
    await expect(column(page, "title")).toHaveText(["Zucchini", "Mango"])
    // A sort orders the rows as saved, so let the rename land first.
    await expect(column(page, "title").first()).toHaveAttribute("aria-busy", "false")

    // Each step waits for the order it asks for, so the next sort starts from a rendered one.
    await getPw(page, "songs-sort").selectOption("tempo")
    await expect(column(page, "title")).toHaveText(["Mango", "Zucchini"])
    await getPw(page, "songs-sort").selectOption("artist")
    await expect(column(page, "title")).toHaveText(["Zucchini", "Mango"])
  })

  test("a song opens read-only, and Edit or Cancel moves between the two modes", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-read"))
    await createSong(page, bandId, { title: "Everlong", artist: "Foo Fighters", tempo_bpm: 158 })

    await page.goto(`/band/${bandId}/songs`)
    await getPw(page, "song-open").click()

    await expect(getPw(page, "song-edit")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "song-title")).toBeDisabled()
    await expect(getPw(page, "song-submit")).toHaveCount(0)
    await expect(getPw(page, "song-delete")).toHaveCount(0)

    await getPw(page, "song-edit").click()
    await expect(page).toHaveURL(/edit=true/)
    await expect(getPw(page, "song-title")).toBeEnabled()
    await getPw(page, "song-title").fill("Changed")
    await getPw(page, "song-cancel").click()

    // Cancel drops the unsaved title and leaves the URL in read view.
    await expect(getPw(page, "song-title")).toBeDisabled()
    await expect(getPw(page, "song-title")).toHaveValue("Everlong")
    await expect(page).not.toHaveURL(/edit=true/)
  })

  test("Hide details gives the charts the whole width, and Details brings the sidebar back", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-hide"))
    const songId = await createSong(page, bandId, { title: "Everlong", artist: "Foo Fighters", tempo_bpm: 158 })

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`/band/${bandId}/songs/${songId}`)
    const charts = getPw(page, "song-charts")
    await expect(getPw(page, "song-edit-form")).toBeVisible({ timeout: 10000 })
    const narrow = (await charts.boundingBox())!.width

    await getPw(page, "song-details-hide").click()
    await expect(getPw(page, "song-edit-form")).toHaveCount(0)
    await expect(getPw(page, "song-edit")).toHaveCount(0)
    expect((await charts.boundingBox())!.width).toBeGreaterThan(narrow)

    await getPw(page, "song-details-show").click()
    await expect(getPw(page, "song-edit-form")).toBeVisible()
    await expect(getPw(page, "song-edit")).toBeVisible()
  })

  test("a score uploaded to an untitled song names the song, and a titled song keeps its name", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-score-meta"))
    const titled = new URL("./fixtures/titled.gp", import.meta.url).pathname
    const upload = async (songId: string) => {
      await page.goto(`/band/${bandId}/songs/${songId}`)
      await getPw(page, "score-add").click()
      await getPw(page, "score-form-file").setInputFiles(titled)
      // The score's own title names the chart.
      await expect(getPw(page, "score-form-name")).toHaveValue("Blackbird")
      await getPw(page, "score-form-submit").click()
      await expect(getPw(page, "score-viewer")).toBeVisible({ timeout: 10000 })
    }

    const untitled = await createSong(page, bandId, { title: "Untitled song", artist: null as unknown as string, tempo_bpm: null as unknown as number })
    await upload(untitled)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Blackbird")
    await expect(getPw(page, "song-artist")).toHaveValue("The Beatles")
    await expect(getPw(page, "song-tempo")).toHaveValue("94")

    const named = await createSong(page, bandId, { title: "My Own Title", artist: "Me", tempo_bpm: 80 })
    await upload(named)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My Own Title")
    await expect(getPw(page, "song-artist")).toHaveValue("Me")
    await expect(getPw(page, "song-tempo")).toHaveValue("80")
  })

  test("rejects a duration that is not mm:ss", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-duration"))

    await page.goto(`/band/${bandId}/songs`)
    await getPw(page, "song-new").click()
    await getPw(page, "song-title").fill("Bad Duration")
    await getPw(page, "song-duration").fill("nope")

    await expect(getPw(page, "song-duration-error")).toBeVisible({ timeout: 5000 })
    // The invalid value blocks submission, so it can never reach the API.
    await expect(getPw(page, "song-submit")).toBeDisabled()
    await expect(getPw(page, "song-edit-form")).toBeVisible()
  })

  test("a new song is saved untitled and opens with charts and delete ready", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-untitled"))

    await page.goto(`/band/${bandId}/songs`)
    await getPw(page, "song-new").click()

    await expect(getPw(page, "song-edit-form")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "song-title")).toHaveValue("Untitled song")
    await expect(getPw(page, "song-charts")).toBeVisible()
    await expect(getPw(page, "chart-add")).toBeEnabled()
    await expect(getPw(page, "song-delete")).toBeEnabled()

    // The song exists already, so a chart can be written before the song is named.
    // "Write a chart" opens the same editor every chart is edited in, on one empty line.
    await getPw(page, "chart-blank").click()
    await expect(getPw(page, "chart-editor")).toBeVisible({ timeout: 10000 })
    await getPw(page, "line-edit").first().click({ force: true })
    await getPw(page, "line-input").fill("Hello darkness")
    await getPw(page, "line-input").press("Enter")
    // The song has no key, so the palette has no suggestions; a chord is typed in.
    await getPw(page, "palette-custom").fill("G")
    await getPw(page, "palette-custom-add").click()
    await getPw(page, "editor-segment").filter({ hasText: "Hello" }).click()
    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-chord").filter({ hasText: "G" })).toHaveCount(1, { timeout: 10000 })
    await expect(getPw(page, "chart")).toHaveCount(1)

    await getPw(page, "song-title").fill("Named Later")
    await getPw(page, "song-submit").click()
    await expect(getPw(page, "song-edit")).toBeVisible({ timeout: 10000 })

    await page.goto(`/band/${bandId}/songs`)
    await expect(column(page, "title")).toHaveText(["Named Later"], { timeout: 10000 })
  })

  test("sorts and searches the catalog", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-filter"))
    await createSong(page, bandId, { title: "Zebra", artist: "The Zeds", tempo_bpm: 90 })
    await createSong(page, bandId, { title: "Apple", artist: "The As", tempo_bpm: 140 })
    await createSong(page, bandId, { title: "Mango", artist: "The Ms", tempo_bpm: 120 })

    await page.goto(`/band/${bandId}/songs`)
    // The default order is the order the songs were added.
    await expect(column(page, "title")).toHaveText(["Zebra", "Apple", "Mango"], { timeout: 10000 })

    await getPw(page, "songs-sort").selectOption("title")
    await expect(column(page, "title")).toHaveText(["Apple", "Mango", "Zebra"])

    await getPw(page, "songs-sort").selectOption("tempo")
    await expect(column(page, "title")).toHaveText(["Zebra", "Mango", "Apple"])

    await getPw(page, "songs-search").fill("mang")
    await expect(column(page, "title")).toHaveText(["Mango"])

    await getPw(page, "songs-search").fill("nothing matches this")
    await expect(getPw(page, "songs-no-match")).toBeVisible({ timeout: 5000 })
  })

  test("refuses a user who is not a member of the band", async ({
    page,
    testing,
    request,
  }) => {
    await testing.login()
    const bandId = await createBand(page, testSlug("songs-authz"))

    // A second user, in its own cookie store, must not reach the first band.
    const username = testing.username("song_outsider")
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
    await createBand(page, testSlug("rls-other"))

    // A fresh user, logged in through the API so its cookie is separate from
    // the page's. Before RLS was enforced this list returned every band in the
    // database rather than only the user's own.
    const username = testing.username("rls_empty")
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
