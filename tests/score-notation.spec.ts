import { readFileSync } from "node:fs"
import { test, expect, getPw } from "./helpers"

const fixture = readFileSync(new URL("./fixtures/four-tracks.gp5", import.meta.url))

test("standard notation and tab toggle, and turning off the last one swaps", async ({ page, testing }) => {
  await testing.login()
  const band = await (await page.request.post("/api/my/bands", { data: { slug: `test-notation-${Date.now()}`, name: "Test: notation" } })).json()
  const song = await (await page.request.post("/api/songs", {
    data: { band_id: band.id, title: "N", artist: null, key: "G", tempo_bpm: null, duration_seconds: null, capo: null, notes: null },
  })).json()
  const up = await page.request.post(`/api/scores?${new URLSearchParams({ song_id: song.id, name: "N", file_name: "four-tracks.gp5" })}`, {
    data: fixture,
    headers: { "content-type": "application/octet-stream" },
  })
  expect(up.ok()).toBe(true)
  await page.goto(`/band/${band.id}/songs/${song.id}`)
  const viewer = getPw(page, "score-viewer")
  const standard = getPw(page, "score-notation-standard")
  const tab = getPw(page, "score-notation-tab")
  await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
  const height = async () => (await getPw(page, "score-render").boundingBox())!.height
  const both = await height()
  await expect(standard).toHaveAttribute("aria-pressed", "true")
  await expect(tab).toHaveAttribute("aria-pressed", "true")

  await tab.click()
  await expect(tab).toHaveAttribute("aria-pressed", "false")
  await expect(standard).toHaveAttribute("aria-pressed", "true")
  await expect.poll(height).toBeLessThan(both * 0.9)

  // The only notation on swaps with the other one.
  await standard.click()
  await expect(standard).toHaveAttribute("aria-pressed", "false")
  await expect(tab).toHaveAttribute("aria-pressed", "true")
  await expect.poll(height).toBeLessThan(both * 0.9)

  await standard.click()
  await expect(standard).toHaveAttribute("aria-pressed", "true")
  await expect(tab).toHaveAttribute("aria-pressed", "true")
  await expect.poll(height).toBeGreaterThan(both * 0.95)
  await expect(viewer).toHaveAttribute("data-status", "ready")
})

test("a drum track keeps its standard notation whatever the tab choice", async ({ page, testing }) => {
  await testing.login()
  const band = await (await page.request.post("/api/my/bands", { data: { slug: `test-notation-${Date.now()}`, name: "Test: notation" } })).json()
  const song = await (await page.request.post("/api/songs", {
    data: { band_id: band.id, title: "D", artist: null, key: "G", tempo_bpm: null, duration_seconds: null, capo: null, notes: null },
  })).json()
  await page.request.post(`/api/scores?${new URLSearchParams({ song_id: song.id, name: "D", file_name: "four-tracks.gp5" })}`, {
    data: fixture,
    headers: { "content-type": "application/octet-stream" },
  })
  await page.goto(`/band/${band.id}/songs/${song.id}`)
  const viewer = getPw(page, "score-viewer")
  await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
  await getPw(page, "score-track").selectOption({ label: "Drums" })
  await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
  const height = async () => (await getPw(page, "score-render").boundingBox())!.height
  const both = await height()
  // Tab only: a guitar would lose its staff; drums have no tab, so they keep the same one.
  await getPw(page, "score-notation-standard").click()
  await expect(viewer).toHaveAttribute("data-rendered", "true")
  await expect.poll(height).toBeCloseTo(both, -1)
  expect(both).toBeGreaterThan(50)
})
