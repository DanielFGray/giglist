import type { Page } from "@playwright/test"
import { test, expect, getPw } from "./helpers"

const pasted = "[Verse 1]\nG        C\nAmazing grace, how sweet"

/** A setlist of three songs, "Set 1" holding the first two and "Encore" the last; the second song has a chart, a mark and an entry key of Bb. */
const createSetlist = async (page: Page) => {
  const post = async (url: string, data: unknown) => {
    const res = await page.request.post(url, { data })
    expect(res.ok(), `${url} failed: ${await res.text()}`).toBe(true)
    return res.json()
  }
  const band = await post("/api/my/bands", { slug: `test-perform-${Date.now()}`, name: "Test: perform" })
  const song = (title: string, key: string | null) =>
    post("/api/songs", { band_id: band.id, title, artist: null, key, tempo_bpm: 120, duration_seconds: null, capo: null, notes: title === "Beta" ? "Watch the break" : null })
  const [alpha, beta, gamma] = [await song("Alpha", "G"), await song("Beta", "G"), await song("Gamma", "D")]
  const chart = await post("/api/charts", { song_id: beta.id, name: "Chords", written_key: "G", pasted })
  await post("/api/marks", {
    revision_id: chart.revision_id, scope: { kind: "chart" }, range_start: 1, range_end: 8, side: "inline",
    dx: 0, dy: 1, scale: 1, body: { kind: "text", text: "tacet" }, visibility: "private",
  })
  const setlist = await post("/api/setlists", { band_id: band.id, name: "Friday", description: null, gig_date: null, status: "draft" })
  const [one, encore] = [await post(`/api/setlists/${setlist.id}/sections`, { name: "Set 1" }), await post(`/api/setlists/${setlist.id}/sections`, { name: "Encore" })]
  const entries = []
  for (const [i, s] of [alpha, beta, gamma].entries()) {
    entries.push(await post(`/api/setlists/${setlist.id}/entries`, { song_id: s.id, position: (i + 1) * 1000 }))
  }
  const betaEntry = entries[1]
  const override = await page.request.put(`/api/setlists/${setlist.id}/entries/${betaEntry.id}`, {
    data: { position: 2000, section_id: null, key_override: "Bb", tempo_override: null, notes_override: null },
  })
  expect(override.ok(), await override.text()).toBe(true)
  const arranged = await page.request.put(`/api/setlists/${setlist.id}/arrangement`, {
    data: {
      groups: [
        { section_id: one.id, entries: [entries[0].id, entries[1].id] },
        { section_id: encore.id, entries: [entries[2].id] },
      ],
    },
  })
  expect(arranged.ok(), await arranged.text()).toBe(true)
  return { bandId: band.id as string, setlistId: setlist.id as string }
}

const chordSize = (page: Page) => getPw(page, "lyrics-chart").evaluate((n) => parseFloat(getComputedStyle(n).fontSize))

test.describe("performance mode", () => {
  test("steps through the setlist by keyboard, buttons, list and swipe, showing each song in its own key", async ({ page, testing }) => {
    await testing.login()
    const { bandId, setlistId } = await createSetlist(page)
    await page.goto(`/band/${bandId}/setlists/${setlistId}`)
    await getPw(page, "setlist-perform").click()

    // The first song, with the section it is in and the song after it.
    await expect(getPw(page, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(page, "perform-section")).toHaveText("Set 1")
    await expect(getPw(page, "perform-position")).toHaveText("1 / 3")
    await expect(getPw(page, "perform-next-title")).toHaveText("Next: Beta")
    await expect(getPw(page, "perform-prev")).toBeDisabled()

    // The overlay covers the whole window.
    const box = (await getPw(page, "perform").boundingBox())!
    expect(box).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 })

    // Arrow key: Beta, in the key its entry overrides to, with the player's mark and no editing tools.
    await page.keyboard.press("ArrowRight")
    await expect(getPw(page, "perform-title")).toHaveText("Beta")
    await expect(page).toHaveURL(/at=2/)
    await expect(getPw(page, "perform-meta")).toContainText("Bb")
    await expect(getPw(page, "perform-notes")).toHaveText("Watch the break")
    await expect.poll(async () => [...new Set((await getPw(page, "chart-chord").allTextContents()).filter(Boolean))].sort()).toEqual(["Bb", "Eb"])
    await expect(getPw(page, "mark")).toHaveText("tacet", { timeout: 10000 })
    await expect(getPw(page, "marks-toolbar")).toHaveCount(0)

    // Button, then the list, then space and back.
    await getPw(page, "perform-next").click()
    await expect(getPw(page, "perform-title")).toHaveText("Gamma")
    await expect(getPw(page, "perform-section")).toHaveText("Encore")
    await expect(getPw(page, "perform-next")).toBeDisabled()
    await getPw(page, "perform-song").first().click()
    await expect(getPw(page, "perform-title")).toHaveText("Alpha")
    await expect(getPw(page, "perform-song").first()).toHaveAttribute("data-current", "true")
    await page.keyboard.press(" ")
    await expect(getPw(page, "perform-title")).toHaveText("Beta")
    await page.keyboard.press("ArrowLeft")
    await expect(getPw(page, "perform-title")).toHaveText("Alpha")

    // A sideways swipe moves on; a short or mostly vertical touch does not.
    const swipe = (dx: number, dy: number) =>
      getPw(page, "perform-scroller").evaluate((el, [dx, dy]) => {
        const touch = (x: number, y: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
        const fire = (type: string, x: number, y: number, ended = false) =>
          el.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: ended ? [] : [touch(x, y)], changedTouches: [touch(x, y)] }))
        fire("touchstart", 400, 300)
        fire("touchend", 400 + dx!, 300 + dy!, true)
      }, [dx, dy])
    await swipe(-20, 0)
    await expect(getPw(page, "perform-title")).toHaveText("Alpha")
    await swipe(-150, 10)
    await expect(getPw(page, "perform-title")).toHaveText("Beta")
    await swipe(150, 10)
    await expect(getPw(page, "perform-title")).toHaveText("Alpha")

    // Escape leaves.
    await page.keyboard.press("Escape")
    await expect(getPw(page, "setlist-perform")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "perform")).toHaveCount(0)
  })

  test("opens at the song number in the address, and remembers the text size", async ({ page, testing }) => {
    await testing.login()
    const { bandId, setlistId } = await createSetlist(page)
    await page.goto(`/band/${bandId}/setlists/${setlistId}/perform?at=2`)
    await expect(getPw(page, "perform-title")).toHaveText("Beta", { timeout: 10000 })
    await expect(getPw(page, "lyrics-chart")).toBeVisible({ timeout: 10000 })

    const before = await chordSize(page)
    await getPw(page, "perform-larger").click()
    await expect.poll(() => chordSize(page)).toBeGreaterThan(before)
    const larger = await chordSize(page)
    await page.keyboard.press("-")
    await expect.poll(() => chordSize(page)).toBeLessThan(larger)
    await getPw(page, "perform-larger").click()

    await page.reload()
    await expect(getPw(page, "lyrics-chart")).toBeVisible({ timeout: 10000 })
    expect(await chordSize(page)).toBe(larger)

    // A number past the end holds at the last song.
    await page.goto(`/band/${bandId}/setlists/${setlistId}/perform?at=99`)
    await expect(getPw(page, "perform-title")).toHaveText("Gamma", { timeout: 10000 })
  })

  test("a phone-width screen shows one song and no list; a tablet shows the list beside it", async ({ page, testing }) => {
    await testing.login()
    const { bandId, setlistId } = await createSetlist(page)
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto(`/band/${bandId}/setlists/${setlistId}/perform`)
    await expect(getPw(page, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(page, "perform-song")).toHaveCount(3)
    await expect(getPw(page, "perform-song").first()).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.setViewportSize({ width: 1024, height: 700 })
    await expect(getPw(page, "perform-song").first()).toBeVisible()
  })

  test("auto-scroll moves a long chart down and stops when switched off", async ({ page, testing }) => {
    await testing.login()
    const { bandId, setlistId } = await createSetlist(page)
    await page.setViewportSize({ width: 1280, height: 300 })
    await page.goto(`/band/${bandId}/setlists/${setlistId}/perform?at=2`)
    await expect(getPw(page, "lyrics-chart")).toBeVisible({ timeout: 10000 })
    // Make the scroll area longer than the window so there is something to scroll.
    await getPw(page, "perform-scroller").evaluate((el) => {
      const pad = document.createElement("div")
      pad.style.height = "4000px"
      el.appendChild(pad)
    })
    const top = () => getPw(page, "perform-scroller").evaluate((el) => el.scrollTop)
    await getPw(page, "perform-scroll").click()
    await getPw(page, "perform-scroll").click()
    await getPw(page, "perform-scroll").click()
    await expect.poll(top, { timeout: 10000 }).toBeGreaterThan(20)
    await getPw(page, "perform-scroll").click()
    await expect(getPw(page, "perform-scroll")).toHaveText("Scroll off")
    const stopped = await top()
    await page.waitForTimeout(500)
    expect(await top()).toBe(stopped)
  })
})
