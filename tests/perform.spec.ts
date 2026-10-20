import { readFileSync } from "node:fs"
import type { Page } from "@playwright/test"
import { test, expect, getPw, createGig } from "./helpers"

const chordSize = (page: Page) => getPw(page, "lyrics-chart").evaluate((n) => parseFloat(getComputedStyle(n).fontSize))

test.describe("performance mode", () => {
  test("steps through the gig's setlists by keyboard, buttons, list and swipe, showing each song in its own key", async ({ page, testing }) => {
    await testing.login()
    const { bandId, gigId } = await createGig(page)
    await page.goto(`/band/${bandId}/gigs/${gigId}`)
    await getPw(page, "gig-perform").click()

    // The first song, with the setlist it is in and the song after it.
    await expect(getPw(page, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(page, "perform-section")).toHaveText("Set 1")
    await expect(getPw(page, "perform-position")).toHaveText("1 / 3")
    await expect(getPw(page, "perform-next-title")).toHaveText("Next: Beta")
    await expect(getPw(page, "perform-prev")).toBeDisabled()
    // The song list heads each setlist with its name.
    await expect(getPw(page, "perform-set-heading")).toHaveText(["Set 1", "Encore"])

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

    // A tapped chord shows its shapes; Escape then closes the shapes and stays on stage.
    await getPw(page, "chart-chord").filter({ hasText: /^Bb$/ }).first().click()
    await expect(getPw(page, "chord-shapes")).toHaveAttribute("aria-label", "Bb on guitar")
    await page.keyboard.press("Escape")
    await expect(getPw(page, "chord-shapes")).toHaveCount(0)
    await expect(getPw(page, "perform-title")).toHaveText("Beta")

    // The stage's own Chord diagrams setting: Off makes a chord text that opens nothing.
    await getPw(page, "perform-diagrams").selectOption("off")
    await getPw(page, "chart-chord").filter({ hasText: /^Bb$/ }).first().click()
    await expect(getPw(page, "chord-shapes")).toHaveCount(0)
    await getPw(page, "perform-diagrams").selectOption("guitar")
    await getPw(page, "chart-chord").filter({ hasText: /^Bb$/ }).first().click()
    await expect(getPw(page, "chord-shapes")).toBeVisible()
    await page.keyboard.press("Escape")

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
    await expect(getPw(page, "gig-perform")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "perform")).toHaveCount(0)
  })

  test("a setlist's own stage page plays only its songs, and Escape goes back to it", async ({ page, testing }) => {
    await testing.login()
    const { bandId, setlistId } = await createGig(page)
    await page.goto(`/band/${bandId}/setlists/${setlistId}`)
    await getPw(page, "setlist-perform").click()
    await expect(getPw(page, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(page, "perform-position")).toHaveText("1 / 2")
    await expect(getPw(page, "perform-section")).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(getPw(page, "setlist-perform")).toBeVisible({ timeout: 10000 })
  })

  test("opens at the song number in the address, and remembers the text size", async ({ page, testing }) => {
    await testing.login()
    const { bandId, gigId } = await createGig(page)
    await page.goto(`/band/${bandId}/gigs/${gigId}/perform?at=2`)
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
    await page.goto(`/band/${bandId}/gigs/${gigId}/perform?at=99`)
    await expect(getPw(page, "perform-title")).toHaveText("Gamma", { timeout: 10000 })
  })

  test("a phone-width screen shows one song and no list; a tablet shows the list beside it", async ({ page, testing }) => {
    await testing.login()
    const { bandId, gigId } = await createGig(page)
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto(`/band/${bandId}/gigs/${gigId}/perform`)
    await expect(getPw(page, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(page, "perform-song")).toHaveCount(3)
    await expect(getPw(page, "perform-song").first()).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.setViewportSize({ width: 1024, height: 700 })
    await expect(getPw(page, "perform-song").first()).toBeVisible()
  })

  test("the click track counts beats at the song's tempo and stops when pressed again", async ({ page, testing }) => {
    await testing.login()
    const { bandId, gigId } = await createGig(page)
    await page.goto(`/band/${bandId}/gigs/${gigId}/perform`)
    await expect(getPw(page, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(page, "perform-click")).toHaveText("Click")

    await getPw(page, "perform-click").click()
    // At 120 BPM a beat lasts half a second, so beat 2 shows within about a second.
    await expect(getPw(page, "perform-click")).toHaveText(/^Click 120 · [1-4]$/, { timeout: 5000 })
    await expect.poll(async () => getPw(page, "perform-click").getAttribute("data-beat"), { timeout: 5000 }).not.toBeNull()

    // Moving to another song stops the click.
    await page.keyboard.press("ArrowRight")
    await expect(getPw(page, "perform-click")).toHaveText("Click")

    await getPw(page, "perform-click").click()
    await expect(getPw(page, "perform-click")).toHaveAttribute("aria-pressed", "true")
    await getPw(page, "perform-click").click()
    await expect(getPw(page, "perform-click")).toHaveText("Click")
    await expect(getPw(page, "perform-click")).not.toHaveAttribute("data-beat")
  })

  test("the chord strip checkbox draws the strip of chords above the chart", async ({ page, testing }) => {
    await testing.login()
    const { bandId, gigId } = await createGig(page)
    // The second song is the one with a lyrics chart.
    await page.goto(`/band/${bandId}/gigs/${gigId}/perform?at=2`)
    await expect(getPw(page, "lyrics-chart")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "chord-strip")).toHaveCount(0)

    await getPw(page, "perform-show-chords-above").check()
    const strip = getPw(page, "chord-strip")
    await expect(strip).toBeVisible()
    await expect(strip.locator("[data-pwid=chord-strip-entry]")).not.toHaveCount(0)
  })

  test("a song with only a score shows neither chord control", async ({ page, testing }) => {
    await testing.login()
    const { bandId, gigId } = await createGig(page)
    // The first song has no chart; giving it a score makes it score-only.
    const entries = (await (await page.request.get(`/api/gigs/${gigId}/entries`)).json()) as Array<{ song_id: string }>
    const scoreOnly = entries[0]!.song_id
    const upload = await page.request.post(
      `/api/scores?${new URLSearchParams({ song_id: scoreOnly, name: "Four tracks", file_name: "four-tracks.gp5" })}`,
      { data: readFileSync(new URL("./fixtures/four-tracks.gp5", import.meta.url)), headers: { "content-type": "application/octet-stream" } },
    )
    expect(upload.ok(), await upload.text()).toBe(true)

    await page.goto(`/band/${bandId}/gigs/${gigId}/perform?at=1`)
    await expect(getPw(page, "score-viewer")).toBeVisible({ timeout: 20000 })
    await expect(getPw(page, "perform-diagrams")).toHaveCount(0)
    await expect(getPw(page, "perform-show-chords-above")).toHaveCount(0)
  })

  test("auto-scroll moves a long chart down and stops when switched off", async ({ page, testing }) => {
    await testing.login()
    const { bandId, gigId } = await createGig(page)
    await page.setViewportSize({ width: 1280, height: 300 })
    await page.goto(`/band/${bandId}/gigs/${gigId}/perform?at=2`)
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
    await expect.poll(top, { timeout: 1000, intervals: [100] }).toBe(stopped)
  })
})
