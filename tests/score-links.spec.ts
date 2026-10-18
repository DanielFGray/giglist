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
})
