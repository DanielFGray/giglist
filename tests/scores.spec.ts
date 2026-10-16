import { readFileSync } from "node:fs"
import type { APIRequestContext, Page } from "@playwright/test"
import { test, expect, getPw } from "./helpers"

const fixturePath = new URL("./fixtures/four-tracks.gp5", import.meta.url)
const fixture = readFileSync(fixturePath)
// A Guitar Pro 5 header followed by nothing: the server accepts it, alphaTab cannot read it.
const truncated = fixture.subarray(0, 200)

/** Create a band and a song through the API; score specs start from a song. */
const createSong = async (page: Page) => {
  const bandRes = await page.request.post("/api/my/bands", {
    data: { slug: `test-scores-${Date.now()}`, name: "Test: scores" },
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
    await expect(play).toHaveText("Play")
    await play.click()
    await expect(play).toHaveText("Pause")
    // alphaTab throws if it is paused before its audio output has started.
    await page.waitForTimeout(500)
    await play.click()
    await expect(play).toHaveText("Play")

    const click = getPw(page, "score-metronome")
    await expect(click).not.toBeChecked()
    await click.check()
    await expect(click).toBeChecked()
  })

  test("shows an error, not a crash, when alphaTab cannot read the file", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)

    await uploadViaUi(page, bandId, songId, { name: "broken.gp5", mimeType: "application/octet-stream", buffer: truncated })

    await expect(getPw(page, "score-error")).toContainText("cannot read this Guitar Pro file", { timeout: 15000 })
    await expect(getPw(page, "score-error")).toContainText("stored unchanged")
    // The page still works: the chart can be deleted.
    await getPw(page, "chart-delete").click()
    await expect(getPw(page, "charts-empty")).toBeVisible({ timeout: 10000 })
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
