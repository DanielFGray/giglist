import { readFileSync } from "node:fs"
import type { APIRequestContext, Page } from "@playwright/test"
import { test, expect, getPw, testSlug } from "./helpers"

const fixturePath = new URL("./fixtures/four-tracks.gp5", import.meta.url)
const fixture = readFileSync(fixturePath)
// A Guitar Pro 5 header followed by nothing: the server accepts it, alphaTab cannot read it.
const truncated = fixture.subarray(0, 200)

/** Create a band and a song through the API; score specs start from a song. */
const createSong = async (page: Page) => {
  const bandRes = await page.request.post("/api/my/bands", {
    data: { slug: testSlug("scores"), name: "Test: scores" },
  })
  expect(bandRes.ok(), `create band failed: ${await bandRes.text()}`).toBe(true)
  const bandId = (await bandRes.json()).id as string
  const songRes = await page.request.post("/api/songs", {
    data: { band_id: bandId, title: "Template", artist: null, key: "G", tempo_bpm: null, duration_seconds: null, capo: null, notes: null },
  })
  expect(songRes.ok(), `create song failed: ${await songRes.text()}`).toBe(true)
  return { bandId, songId: (await songRes.json()).id as string }
}

const uploadScore = (request: APIRequestContext, songId: string, bytes: Buffer, fileName = "four-tracks.gp5") =>
  request.post(`/api/scores?${new URLSearchParams({ song_id: songId, name: "Four tracks", file_name: fileName })}`, {
    data: bytes,
    headers: { "content-type": "application/octet-stream" },
  })

const uploadViaUi = async (page: Page, bandId: string, songId: string, file: string | { name: string; mimeType: string; buffer: Buffer }) => {
  await page.goto(`/band/${bandId}/songs/${songId}`)
  await getPw(page, "score-add").click()
  await getPw(page, "score-form-file").setInputFiles(file)
  await getPw(page, "score-form-submit").click()
  await expect(getPw(page, "score-viewer")).toBeVisible({ timeout: 10000 })
}

test.describe("scores", () => {
  test("uploads a Guitar Pro file, shows its tracks, and keeps the bytes unchanged", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)

    await uploadViaUi(page, bandId, songId, fixturePath.pathname)

    await expect(getPw(page, "chart-name")).toContainText("four-tracks")
    const viewer = getPw(page, "score-viewer")
    // alphaTab draws after its worker finishes; bar positions exist only from then on.
    await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
    await expect(getPw(page, "score-render").locator("svg").first()).toBeVisible()
    await expect(getPw(page, "score-track").locator("option")).toHaveText(["Guitar 1", "Guitar 2", "Bass", "Drums"])
    await expect(getPw(page, "score-error")).toHaveCount(0)

    // The file the viewer reads is the file that was uploaded, byte for byte.
    const charts = (await (await page.request.get(`/api/charts/song/${songId}`)).json()) as Array<{ kind: string; revision_id: string }>
    expect(charts.map((c) => c.kind)).toEqual(["score"])
    const served = await page.request.get(`/api/scores/${charts[0]!.revision_id}/file`)
    expect(served.status()).toBe(200)
    expect(Buffer.compare(await served.body(), fixture)).toBe(0)

    // Another track redraws the score.
    await getPw(page, "score-track").selectOption({ label: "Bass" })
    await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
    await expect(getPw(page, "score-track")).toHaveValue("2")
  })

  test("has play, pause and a metronome click", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    expect((await uploadScore(page.request, songId, fixture)).status()).toBe(201)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    // The play button waits for the sound font, a download of about 1 MB.
    const play = getPw(page, "score-play")
    await expect(play).toBeEnabled({ timeout: 30000 })
    await expect(play).toHaveAttribute("aria-label", "Play")
    await play.click()
    await expect(play).toHaveAttribute("aria-label", "Pause")
    // alphaTab's playerStateChanged event has changed the button to Pause, but its audio output needs this handoff before pausing.
    await page.waitForTimeout(500)
    await play.click()
    await expect(play).toHaveAttribute("aria-label", "Play")

    const click = getPw(page, "score-metronome")
    await expect(click).toHaveAttribute("aria-pressed", "false")
    await click.click()
    await expect(click).toHaveAttribute("aria-pressed", "true")
  })

  test("the player bar has count-in, a time readout, a speed and a speed trainer", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    expect((await uploadScore(page.request, songId, fixture)).status()).toBe(201)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await expect(getPw(page, "score-play")).toBeEnabled({ timeout: 30000 })

    const countIn = getPw(page, "score-count-in")
    await expect(countIn).toHaveAttribute("aria-pressed", "false")
    await countIn.click()
    await expect(countIn).toHaveAttribute("aria-pressed", "true")

    // The seek bar spans the piece, so the readout names its length.
    await expect(getPw(page, "score-time")).not.toHaveText("0:00 / 0:00")

    // A typed speed is kept, and one past the limit stops at the limit.
    const speed = getPw(page, "score-speed")
    await speed.fill("0.5")
    await speed.press("Enter")
    await expect(speed).toHaveValue("0.5")
    await speed.fill("9")
    await speed.press("Enter")
    await expect(speed).toHaveValue("3")

    // The trainer's panel holds the loop switch and the speed-up step.
    await getPw(page, "score-trainer-open").click()
    await expect(getPw(page, "score-trainer")).toBeVisible()
    await getPw(page, "score-loop").check()
    await expect(getPw(page, "score-loop")).toBeChecked()
    await getPw(page, "score-trainer-mode").selectOption("bpm")
    await expect(getPw(page, "score-trainer-mode")).toHaveValue("bpm")
  })

  test("a score is redrawn in the new ink when the theme toggles", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    expect((await uploadScore(page.request, songId, fixture)).status()).toBe(201)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    const viewer = getPw(page, "score-viewer")
    await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })

    // The first staff line's stroke is the ink alphaTab drew with.
    const ink = () => getPw(page, "score-render").locator("svg path, svg rect").first().evaluate((el) => el.getAttribute("fill") ?? el.getAttribute("stroke"))
    const setTheme = (theme: "light" | "dark") =>
      page.evaluate((t) => {
        document.documentElement.classList.remove("light", "dark")
        document.documentElement.classList.add(t)
      }, theme)

    await setTheme("light")
    await expect(viewer).toHaveAttribute("data-rendered", "true")
    const light = await ink()
    await setTheme("dark")
    await expect.poll(ink, { timeout: 15000 }).not.toBe(light)
  })

  test("shows an error, not a crash, when alphaTab cannot read the file", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)

    await uploadViaUi(page, bandId, songId, { name: "broken.gp5", mimeType: "application/octet-stream", buffer: truncated })

    await expect(getPw(page, "score-error")).toContainText("cannot read this Guitar Pro file", { timeout: 15000 })
    await expect(getPw(page, "score-error")).toContainText("stored unchanged")
    // The page still works: the chart can be deleted, but only in the page's edit mode.
    await expect(getPw(page, "chart-delete")).toHaveCount(0)
    await page.goto(`/band/${bandId}/songs/${songId}?edit=true`)
    await getPw(page, "chart-delete").click()
    await expect(getPw(page, "charts-empty")).toBeVisible({ timeout: 10000 })
  })

  test("reads chords over lyrics from the score, which the player corrects and adds beside it", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "score-add").click()
    await getPw(page, "score-form-file").setInputFiles(new URL("./fixtures/amazing-grace.gp", import.meta.url).pathname)

    // The file has lyrics, so the chart is offered ticked; it names no chords, so the form says they were worked out.
    await expect(getPw(page, "score-form-chart")).toBeChecked()
    await expect(getPw(page, "score-form-chart-inferred")).toBeVisible()
    await expect(getPw(page, "score-form-chart-key")).toHaveValue("G")
    const text = getPw(page, "score-form-chart-text")
    await expect(text).toHaveValue("G       C         D         G\nAmazing grace how sweet the sound")

    await text.fill("G       C         D7        G\nAmazing grace how sweet the sound")
    await getPw(page, "score-form-submit").click()
    // With both kinds of chart, the page opens on the chord sheets.
    await expect(getPw(page, "chart").filter({ hasText: "written in G" })).toContainText("Amazing", { timeout: 10000 })
    await getPw(page, "chart-view-score").click()
    await expect(getPw(page, "score-viewer")).toBeVisible({ timeout: 10000 })

    const charts = (await (await page.request.get(`/api/charts/song/${songId}`)).json()) as Array<{ kind: string; name: string; written_key: string | null; source: string | null }>
    const lyrics = charts.find((c) => c.kind === "lyrics")
    expect(charts.map((c) => c.kind).toSorted()).toEqual(["lyrics", "score"])
    expect(lyrics).toMatchObject({ name: "Chords", written_key: "G" })
    expect(lyrics!.source).toContain("[D7]sweet")
  })

  test("refuses a file that is not Guitar Pro", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)

    const res = await uploadScore(page.request, songId, Buffer.from("%PDF-1.7 not a score"), "chart.pdf")
    expect(res.status()).toBe(400)
    expect(await res.text()).toContain("not a Guitar Pro file")

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "score-add").click()
    await getPw(page, "score-form-file").setInputFiles({ name: "chart.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 not a score") })
    await expect(getPw(page, "score-form-error")).toContainText("not a Guitar Pro file")
    await expect(getPw(page, "score-form-submit")).toBeDisabled()
  })

  test("a user outside the band can neither upload a score nor read one", async ({ page, testing }) => {
    await testing.login({ username: "test_score_owner" })
    const { songId } = await createSong(page)
    expect((await uploadScore(page.request, songId, fixture)).status()).toBe(201)
    const [chart] = (await (await page.request.get(`/api/charts/song/${songId}`)).json()) as Array<{ revision_id: string }>

    await testing.login({ username: "test_score_outsider" })
    expect((await uploadScore(page.request, songId, fixture)).status()).toBe(403)
    expect((await page.request.get(`/api/scores/${chart!.revision_id}/file`)).status()).toBe(403)
    expect((await page.request.get(`/api/charts/song/${songId}`)).status()).toBe(403)

    // Signed out, the file is as unreachable.
    await page.context().clearCookies()
    expect((await page.request.get(`/api/scores/${chart!.revision_id}/file`)).status()).toBe(403)
  })
})
