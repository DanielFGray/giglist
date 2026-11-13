import { readFileSync } from "node:fs"
import { test, expect, getPw, testSlug } from "./helpers"

const fixture = readFileSync(new URL("./fixtures/four-tracks.gp5", import.meta.url))

test("zoom resizes the score and is remembered", async ({ page, testing }) => {
  await testing.login()
  const band = await (await page.request.post("/api/my/bands", { data: { slug: testSlug("zoom"), name: "Test: zoom" } })).json()
  const song = await (await page.request.post("/api/songs", {
    data: { band_id: band.id, title: "Z", artist: null, key: "G", tempo_bpm: null, duration_seconds: null, capo: null, notes: null },
  })).json()
  const up = await page.request.post(`/api/scores?${new URLSearchParams({ song_id: song.id, name: "Z", file_name: "four-tracks.gp5" })}`, {
    data: fixture,
    headers: { "content-type": "application/octet-stream" },
  })
  expect(up.ok()).toBe(true)
  await page.goto(`/band/${band.id}/songs/${song.id}`)
  const viewer = getPw(page, "score-viewer")
  await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
  const height = async () => (await getPw(page, "score-render").boundingBox())!.height
  const before = await height()
  await getPw(page, "score-zoom-in").click()
  await getPw(page, "score-zoom-in").click()
  await expect(getPw(page, "score-zoom")).toHaveText("120%")
  await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
  await expect.poll(height).toBeGreaterThan(before * 1.1)
  await page.reload()
  await expect(getPw(page, "score-zoom")).toHaveText("120%")
  await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
  await getPw(page, "score-zoom").click()
  await expect(getPw(page, "score-zoom")).toHaveText("100%")
  await expect.poll(height).toBeLessThan(before * 1.05)
})

test("a score is shortened and scrolls in its own box in edit mode", async ({ page, testing }) => {
  await testing.login()
  const band = await (await page.request.post("/api/my/bands", { data: { slug: testSlug("compact"), name: "Test: compact" } })).json()
  const song = await (await page.request.post("/api/songs", {
    data: { band_id: band.id, title: "C", artist: null, key: "G", tempo_bpm: null, duration_seconds: null, capo: null, notes: null },
  })).json()
  await page.request.post(`/api/scores?${new URLSearchParams({ song_id: song.id, name: "C", file_name: "four-tracks.gp5" })}`, {
    data: fixture,
    headers: { "content-type": "application/octet-stream" },
  })
  await page.setViewportSize({ width: 1200, height: 700 })
  // The fixture is short at 100%, so zoom in until it is taller than the compact box.
  await page.addInitScript(() => localStorage.setItem("setlist:score-zoom", "2.5"))
  await page.goto(`/band/${band.id}/songs/${song.id}`)
  const viewer = getPw(page, "score-viewer")
  await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
  const box = getPw(page, "score-page")
  const full = (await box.boundingBox())!.height
  expect(full).toBeGreaterThan(700 * 0.4 + 10)

  await page.goto(`/band/${band.id}/songs/${song.id}?edit=true`)
  await expect(viewer).toHaveAttribute("data-rendered", "true", { timeout: 30000 })
  const compact = (await box.boundingBox())!.height
  expect(compact).toBeLessThanOrEqual(700 * 0.4 + 1)
  expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
})
