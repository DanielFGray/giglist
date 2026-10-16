import type { Locator, Page } from "@playwright/test"
import { deleteLine, insertLineAfter, parseDoc, serializeDoc, type Edit } from "../src/charts/doc"
import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

/** A band, a song and a bare-lyrics chart; marks start from a chart. */
const createChart = async (page: Page) => {
  const bandRes = await page.request.post("/api/my/bands", {
    data: { slug: `test-marks-${Date.now()}`, name: "Test: marks" },
  })
  const bandId = (await bandRes.json()).id as string
  const song = await (
    await page.request.post("/api/songs", {
      data: { band_id: bandId, title: "Amazing Grace", artist: null, key: "G", tempo_bpm: null, duration_seconds: null, capo: null, notes: null },
    })
  ).json()
  const res = await page.request.post("/api/charts", {
    data: { song_id: song.id, name: "Words", written_key: "G", pasted: "[Verse 1]\nAmazing grace, how sweet\nThe sound\nThat saved a wretch" },
  })
  expect(res.ok(), `create chart failed: ${await res.text()}`).toBe(true)
  const chart = (await res.json()) as { id: string; revision_id: string; source: string }
  return { bandId, songId: song.id as string, chart, url: `/band/${bandId}/songs/${song.id}` }
}

/** Saves an editor-style revision of the chart, as the editor would. */
const saveEdit = async (page: Page, chart: { id: string; revision_id: string; source: string }, edit: (doc: ReturnType<typeof parseDoc>) => Edit) => {
  const result = edit(parseDoc(chart.source))
  const res = await page.request.post(`/api/charts/${chart.id}/revisions`, {
    data: { parent_id: chart.revision_id, source: serializeDoc(result.doc), changes: result.changes },
  })
  expect(res.ok(), `save revision failed: ${await res.text()}`).toBe(true)
}

const word = (page: Page, text: string) => getPw(page, "chart-lyric").filter({ hasText: text }).first()

const center = async (target: Locator) => {
  const box = (await target.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const placeText = async (page: Page, text: string, on: string) => {
  await getPw(page, "tool-text").click()
  await getPw(page, "mark-text-input").fill(text)
  const at = await center(word(page, on))
  await page.mouse.click(at.x, at.y)
}

/** Draws one stroke through `points` with the ink tool. */
const stroke = async (page: Page, points: ReadonlyArray<{ x: number; y: number }>) => {
  await page.mouse.move(points[0]!.x, points[0]!.y)
  await page.mouse.down()
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 4 })
  await page.mouse.up()
}

/** How far the mark sits below and right of a word; unchanged while the mark stays anchored to it. */
const offsetFrom = async (mark: Locator, on: Locator) => {
  const [m, w] = [(await mark.boundingBox())!, (await on.boundingBox())!]
  return { x: Math.round(m.x - w.x), y: Math.round(m.y - w.y) }
}

test.describe("marks", () => {
  test("places a text mark on a word, keeps it across reload, and moves it with the word when text is added above", async ({ page, testing }) => {
    await testing.login()
    const { url, chart } = await createChart(page)
    await page.goto(url)
    await expect(getPw(page, "marked-chart")).toBeVisible({ timeout: 10000 })

    await placeText(page, "rit.", "sweet")
    await expect(getPw(page, "mark")).toHaveText("rit.", { timeout: 10000 })

    await page.reload()
    await expect(getPw(page, "mark")).toHaveText("rit.", { timeout: 10000 })
    const before = await offsetFrom(getPw(page, "mark"), word(page, "sweet"))

    // A line is added above the marked word; the mark moves down with it.
    await saveEdit(page, chart, (doc) => insertLineAfter(doc, 0))
    await page.reload()
    await expect(getPw(page, "mark")).toHaveText("rit.", { timeout: 10000 })
    expect(await offsetFrom(getPw(page, "mark"), word(page, "sweet"))).toEqual(before)
    await expect(getPw(page, "mark")).toHaveAttribute("data-state", "kept")
  })

  test("a mark whose words were deleted waits in the tray", async ({ page, testing }) => {
    await testing.login()
    const { url, chart } = await createChart(page)
    await page.goto(url)
    await expect(getPw(page, "marked-chart")).toBeVisible({ timeout: 10000 })
    await placeText(page, "breathe", "sweet")
    await expect(getPw(page, "mark")).toHaveCount(1, { timeout: 10000 })

    await saveEdit(page, chart, (doc) => deleteLine(doc, doc.findIndex((l) => l.kind === "lyrics" && l.text.startsWith("Amazing"))))
    await page.reload()
    await expect(getPw(page, "tray-item")).toHaveCount(1, { timeout: 10000 })
    await expect(getPw(page, "tray-item")).toContainText("breathe")
    await expect(getPw(page, "mark")).toHaveCount(0)

    await getPw(page, "tray-delete").click()
    await expect(getPw(page, "tray")).toHaveCount(0)
  })

  test("draws ink; strokes drawn close together join one mark, a far one starts another", async ({ page, testing }) => {
    await testing.login()
    const { url } = await createChart(page)
    await page.goto(url)
    await expect(getPw(page, "marked-chart")).toBeVisible({ timeout: 10000 })
    await getPw(page, "tool-ink").click()

    const at = await center(word(page, "sound"))
    await stroke(page, [{ x: at.x, y: at.y + 20 }, { x: at.x + 20, y: at.y + 30 }, { x: at.x + 40, y: at.y + 20 }])
    await expect(getPw(page, "mark")).toHaveCount(1, { timeout: 10000 })
    await expect(getPw(page, "mark").locator("path")).toHaveCount(1)

    await stroke(page, [{ x: at.x + 5, y: at.y + 38 }, { x: at.x + 35, y: at.y + 38 }])
    await expect(getPw(page, "mark").locator("path")).toHaveCount(2, { timeout: 10000 })
    await expect(getPw(page, "mark")).toHaveCount(1)

    // The margin is the strip at the chart's right edge, so the stroke starts there.
    const frame = (await getPw(page, "marked-chart").boundingBox())!
    const right = frame.x + frame.width
    await stroke(page, [{ x: right - 20, y: frame.y + 10 }, { x: right - 5, y: frame.y + 20 }])
    await expect(getPw(page, "mark")).toHaveCount(2, { timeout: 10000 })

    await page.reload()
    await expect(getPw(page, "mark")).toHaveCount(2, { timeout: 10000 })
  })

  test("moves a mark, shares it, and pastes a saved stamp", async ({ page, testing }) => {
    await testing.login()
    const { url } = await createChart(page)
    await page.goto(url)
    await expect(getPw(page, "marked-chart")).toBeVisible({ timeout: 10000 })
    await placeText(page, "1 e & a", "grace")
    const mark = getPw(page, "mark")
    await expect(mark).toHaveCount(1, { timeout: 10000 })
    await expect(mark).toHaveAttribute("data-shared", "private")

    // Move it onto another word; it re-anchors there and the position survives a reload.
    await getPw(page, "tool-move").click()
    const from = await center(mark)
    const to = await center(word(page, "wretch"))
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => Math.abs((await center(mark)).y - to.y)).toBeLessThan(6)
    const moved = await center(mark)
    await page.reload()
    await expect(mark).toHaveCount(1, { timeout: 10000 })
    expect(Math.abs((await center(mark)).y - moved.y)).toBeLessThan(2)

    // Share with the band, save as a stamp, and paste the stamp elsewhere.
    await getPw(page, "tool-move").click()
    const here = await center(mark)
    await page.mouse.click(here.x, here.y)
    await getPw(page, "mark-share").click()
    await expect(mark).toHaveAttribute("data-shared", "mine", { timeout: 10000 })
    await getPw(page, "mark-stamp-name").fill("subdivide")
    await getPw(page, "mark-stamp-save").click()

    await getPw(page, "tool-stamp").click()
    await expect(getPw(page, "stamp-select")).toContainText("subdivide", { timeout: 10000 })
    const target = await center(word(page, "sound"))
    await page.mouse.click(target.x, target.y)
    await expect(getPw(page, "mark")).toHaveCount(2, { timeout: 10000 })
    await expect(getPw(page, "mark")).toHaveText(["1 e & a", "1 e & a"])
  })

  test("a bandmate sees a mark only while it is shared, and cannot change it", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, url, chart } = await createChart(page)
    const context = await browser.newContext()
    const mate = await context.newPage()
    await mate.request.post("/api/testing/login", { data: { username: "test_bandmate", password: TEST_PASSWORD } })
    await page.request.post("/api/testing/band-member", { data: { band_id: bandId, username: "test_bandmate" } })

    await page.goto(url)
    await expect(getPw(page, "marked-chart")).toBeVisible({ timeout: 10000 })
    await placeText(page, "watch the break", "grace")
    await expect(getPw(page, "mark")).toHaveCount(1, { timeout: 10000 })

    // Private marks are the player's own.
    await mate.goto(url)
    await expect(getPw(mate, "marked-chart")).toBeVisible({ timeout: 10000 })
    await expect(getPw(mate, "mark")).toHaveCount(0)

    // Shared, the mark shows for the bandmate as theirs to read, with no way to edit it.
    await getPw(page, "tool-move").click()
    const here = await center(getPw(page, "mark"))
    await page.mouse.click(here.x, here.y)
    await getPw(page, "mark-share").click()
    await expect(getPw(page, "mark")).toHaveAttribute("data-shared", "mine", { timeout: 10000 })
    await mate.reload()
    await expect(getPw(mate, "mark")).toHaveText("watch the break", { timeout: 10000 })
    await expect(getPw(mate, "mark")).toHaveAttribute("data-shared", "theirs")
    await getPw(mate, "tool-move").click()
    const there = await center(getPw(mate, "mark"))
    await mate.mouse.click(there.x, there.y)
    await expect(getPw(mate, "mark-share")).toHaveCount(0)
    const listed = (await (await mate.request.get(`/api/marks/chart/${chart.id}`)).json()) as { marks: Array<{ id: string }> }
    const markId = listed.marks[0]!.id
    expect((await mate.request.delete(`/api/marks/${markId}`)).ok()).toBe(false)

    // Taking it back removes it from their view.
    await getPw(page, "mark-share").click()
    await expect(getPw(page, "mark")).toHaveAttribute("data-shared", "private", { timeout: 10000 })
    await mate.reload()
    await expect(getPw(mate, "marked-chart")).toBeVisible({ timeout: 10000 })
    await expect(getPw(mate, "mark")).toHaveCount(0)
    await context.close()
  })

  test("another player cannot list or add marks on a chart outside their bands", async ({ page, testing }) => {
    await testing.login({ username: "test_marks_owner" })
    const { chart } = await createChart(page)
    const body = {
      revision_id: chart.revision_id, scope: { kind: "chart" }, range_start: 0, range_end: 3,
      side: "inline", dx: 0, dy: 0, scale: 1, body: { kind: "text", text: "mine" }, visibility: "private",
    }
    expect((await page.request.post("/api/marks", { data: body })).status()).toBe(201)

    await testing.login({ username: "test_marks_outsider" })
    expect((await page.request.get(`/api/marks/chart/${chart.id}`)).status()).toBe(403)
    expect((await page.request.post("/api/marks", { data: body })).status()).toBe(403)
  })
})

