import { readFileSync } from "node:fs"
import type { APIRequestContext, Page } from "@playwright/test"
import { test, expect, getPw } from "./helpers"

const score = readFileSync(new URL("./fixtures/sections.gp", import.meta.url))

/** A band, a song in G, and a score chart uploaded to it: the score a link names. */
const setUp = async (page: Page) => {
  const bandRes = await page.request.post("/api/my/bands", {
    data: { slug: `test-score-links-${Date.now()}`, name: "Test: score links" },
  })
  expect(bandRes.ok(), `create band failed: ${await bandRes.text()}`).toBe(true)
  const bandId = (await bandRes.json()).id as string
  const songRes = await page.request.post("/api/songs", {
    data: { band_id: bandId, title: "Sections", artist: null, key: "G", tempo_bpm: null, duration_seconds: null, capo: null, notes: null },
  })
  expect(songRes.ok(), `create song failed: ${await songRes.text()}`).toBe(true)
  const songId = (await songRes.json()).id as string
  const scoreChart = await uploadScore(page.request, songId)
  return { bandId, songId, scoreId: scoreChart.id as string }
}

const uploadScore = async (request: APIRequestContext, songId: string) => {
  const res = await request.post(`/api/scores?${new URLSearchParams({ song_id: songId, name: "Sections", file_name: "sections.gp" })}`, {
    data: score,
    headers: { "content-type": "application/octet-stream" },
  })
  expect(res.ok(), `upload score failed: ${await res.text()}`).toBe(true)
  return res.json()
}

/** A lyrics chart whose text is the given lines. */
const addLyricsChart = async (request: APIRequestContext, songId: string, lines: string[]) => {
  const res = await request.post("/api/charts", {
    data: { song_id: songId, name: "Words", written_key: "G", pasted: lines.join("\n") },
  })
  expect(res.ok(), `create chart failed: ${await res.text()}`).toBe(true)
}

test.describe("score links", () => {
  test("draws the section a link names, and says why a link cannot be drawn", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId, scoreId } = await setUp(page)
    await addLyricsChart(page.request, songId, [
      `{score: chart=${scoreId} track="Lead Gtr" section="Chorus"}`,
      `{score: chart=${scoreId} track="Lead Gtr" bars=2-3}`,
      `{score: chart=${scoreId} track="Nope" section="Chorus"}`,
      `{score: chart=${scoreId} track="Lead Gtr" bars=7-9}`,
      `{score: chart=${scoreId} track="Lead Gtr" section="Bridge"}`,
      `{score: chart=00000000-0000-4000-8000-000000000000 track="Lead Gtr" section="Chorus"}`,
      `Amazing grace`,
    ])

    await page.goto(`/band/${bandId}/songs/${songId}`)
    const links = getPw(page, "score-link")
    await expect(links).toHaveCount(6, { timeout: 15000 })

    await expect(links.nth(0)).toHaveAttribute("data-status", "ready", { timeout: 15000 })
    await expect(links.nth(0).locator("svg").first()).toBeVisible()
    await expect(links.nth(1)).toHaveAttribute("data-status", "ready", { timeout: 15000 })

    await expect(links.nth(2).getByRole("alert")).toHaveText(`No track named "Nope" in this score`)
    await expect(links.nth(3).getByRole("alert")).toHaveText("The bars 7-9 run past the score's 8 bars")
    await expect(links.nth(4).getByRole("alert")).toHaveText(`No section "Bridge" in this score`)
    await expect(links.nth(5).getByRole("alert")).toHaveText("This score is not in this song")
  })

  test("the editor's picker writes a link that draws in the chart", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId, scoreId } = await setUp(page)
    await addLyricsChart(page.request, songId, ["[Verse]", "Amazing grace"])

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").first().click()
    await getPw(page, "line-score").first().click()
    const picker = getPw(page, "score-picker")
    await expect(picker.locator("[data-pwid=score-link][data-status=ready]")).toBeVisible({ timeout: 15000 })

    await getPw(page, "score-picker-section").selectOption("Chorus")
    await expect(picker.locator("[data-pwid=score-link][data-status=ready]")).toBeVisible({ timeout: 15000 })

    await getPw(page, "score-picker-mode").selectOption("bars")
    await getPw(page, "score-picker-to").fill("9")
    await expect(getPw(page, "score-picker-keep")).toBeDisabled()
    await expect(picker.getByRole("alert")).toHaveText("The bars 1-9 run past the score's 8 bars")

    await getPw(page, "score-picker-mode").selectOption("section")
    await getPw(page, "score-picker-section").selectOption("Chorus")
    await getPw(page, "score-picker-keep").click()
    await expect(getPw(page, "editor-score-link")).toHaveCount(1)
    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })

    await expect(getPw(page, "chart-score-link").locator("[data-pwid=score-link][data-status=ready]")).toBeVisible({ timeout: 15000 })

    // The saved text names the score chart, so a re-upload of that chart redraws the link.
    const listed = (await (await page.request.get(`/api/charts/song/${songId}`)).json()) as Array<{ kind: string; source: string | null }>
    const lyrics = listed.find((chart) => chart.kind === "lyrics")
    expect(lyrics?.source).toContain(`{score: chart=${scoreId} track="Lead Gtr" section="Chorus"}`)
  })

  test("the editor deletes a score link, and the saved chart loses it", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId, scoreId } = await setUp(page)
    await addLyricsChart(page.request, songId, [`{score: chart=${scoreId} track="Lead Gtr" bars=1-2}`, "Amazing grace"])

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").first().click()
    await getPw(page, "editor-score-link").locator("[data-pwid=line-delete]").click()
    await expect(getPw(page, "editor-score-link")).toHaveCount(0)
    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(page, "chart-score-link")).toHaveCount(0)

    const listed = (await (await page.request.get(`/api/charts/song/${songId}`)).json()) as Array<{ kind: string; source: string | null }>
    const lyrics = listed.find((chart) => chart.kind === "lyrics")
    expect(lyrics?.source).not.toContain("{score:")
    expect(lyrics?.source).toContain("Amazing grace")
  })

  test("dragging immediately after the score draws fills in the bar inputs, and typed bars move the selection", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await setUp(page)
    await addLyricsChart(page.request, songId, ["[Verse]", "Amazing grace"])

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").first().click()
    await getPw(page, "line-score").first().click()
    const view = getPw(page, "score-picker-score-render")
    await expect(view.locator("svg").first()).toBeVisible({ timeout: 15000 })
    await view.scrollIntoViewIfNeeded()
    const box = await view.boundingBox()
    expect(box).not.toBeNull()
    const at = (fx: number, fy: number) => [box!.x + box!.width * fx, box!.y + box!.height * fy] as const

    // The first system holds bars 1 and 2, so the drag covers them.
    const [startX, startY] = at(0.1, 0.22)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    for (const fx of [0.2, 0.3, 0.4, 0.5]) await page.mouse.move(...at(fx, 0.22), { steps: 4 })
    await page.mouse.up()

    await expect(view).toHaveAttribute("data-selection", "0-1")
    await expect(getPw(page, "score-picker-from")).toHaveValue("1")
    await expect(getPw(page, "score-picker-to")).toHaveValue("2")

    await getPw(page, "score-picker-to").fill("3")
    await expect(view).toHaveAttribute("data-selection", "0-2")
    await expect(view.locator(".at-selection > div").first()).toBeVisible()

    await getPw(page, "score-picker-score-loop").check()
    await expect(getPw(page, "score-picker-score-loop")).toBeChecked()
    const play = getPw(page, "score-picker-score-play")
    await play.click()
    await expect(play).toHaveText("Stop", { timeout: 15000 })
    await expect(view).toHaveAttribute("data-selection", "0-2")
    await play.click()
    await expect(play).toHaveText("Play")
  })

  test("a score link loads no sound font until Play", async ({ page, testing }) => {
    const soundFonts: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith(".sf2")) soundFonts.push(request.url())
    })
    await testing.login()
    const { bandId, songId, scoreId } = await setUp(page)
    await addLyricsChart(page.request, songId, [`{score: chart=${scoreId} track="Lead Gtr" bars=1-2}`])
    await page.goto(`/band/${bandId}/songs/${songId}`)
    const view = getPw(page, "score-link-render")
    await expect(view.locator("svg").first()).toBeVisible({ timeout: 15000 })
    await view.hover()
    await page.waitForLoadState("networkidle")
    expect(soundFonts).toEqual([])

    await getPw(page, "score-link-play").click()
    await expect.poll(() => soundFonts.length).toBe(1)
    await expect(getPw(page, "score-link-play")).toHaveText("Stop", { timeout: 15000 })
  })

  test("a song with a chord sheet and a score shows one of them at a time", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await setUp(page)
    await addLyricsChart(page.request, songId, ["[Verse]", "Amazing grace"])

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await expect(getPw(page, "chart-view-chords")).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByText("Amazing grace")).toBeVisible()
    await expect(getPw(page, "score-viewer")).toHaveCount(0)

    await getPw(page, "chart-view-score").click()
    await expect(getPw(page, "score-viewer")).toHaveCount(1, { timeout: 15000 })
    await expect(page.getByText("Amazing grace")).toHaveCount(0)

    await getPw(page, "chart-view-chords").click()
    await expect(page.getByText("Amazing grace")).toBeVisible()
  })
})
