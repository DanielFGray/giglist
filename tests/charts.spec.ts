import { readFileSync } from "node:fs"
import type { APIRequestContext, Page } from "@playwright/test"
import type { Change } from "../src/charts/changes"
import { parseDoc, placeChord, serializeDoc } from "../src/charts/doc"
import { test, expect, getPw, openTool } from "./helpers"

const fixturePath = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname
const pasted = readFileSync(fixturePath("amazing-grace.txt"), "utf8")

/** Create a band and a song in G through the API; chart specs start from a song. */
const createSong = async (page: Page, tempo: number | null = null) => {
  const bandRes = await page.request.post("/api/my/bands", {
    data: { slug: `test-charts-${Date.now()}`, name: "Test: charts" },
  })
  expect(bandRes.ok(), `create band failed: ${await bandRes.text()}`).toBe(true)
  const bandId = (await bandRes.json()).id as string
  const songRes = await page.request.post("/api/songs", {
    data: { band_id: bandId, title: "Amazing Grace", artist: null, key: "G", tempo_bpm: tempo, duration_seconds: null, capo: null, notes: null },
  })
  expect(songRes.ok(), `create song failed: ${await songRes.text()}`).toBe(true)
  return { bandId, songId: (await songRes.json()).id as string }
}

const createChart = async (request: APIRequestContext, songId: string) => {
  const res = await request.post("/api/charts", {
    data: { song_id: songId, name: "Chords", written_key: "G", pasted },
  })
  expect(res.ok(), `create chart failed: ${await res.text()}`).toBe(true)
}

/** The chords of each chord row of chords-over-lyrics text. */
const chordRows = (text: string) =>
  text.split("\n").filter((row) => /^\s*[A-G]\S*(\s+[A-G]\S*)*\s*$/.test(row)).map((row) => row.trim().split(/\s+/).join(" "))

/** The lyrics as drawn, with the chords above them left out. */
const shownLyrics = async (page: Page) => (await getPw(page, "chart-lyric").allTextContents()).join("")

/** The distinct chords as drawn. Polls: a key change redraws after the URL updates. */
const expectChords = (page: Page, chords: ReadonlyArray<string>) =>
  expect
    .poll(async () => [...new Set((await getPw(page, "chart-chord").allTextContents()).filter(Boolean))].sort())
    .toEqual([...chords].sort())

test.describe("lyrics charts", () => {
  test("pastes chords over lyrics and shows them in the key the player picks", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await expect(getPw(page, "charts-empty")).toBeVisible({ timeout: 10000 })

    await getPw(page, "chart-add").click()
    await getPw(page, "chart-form-pasted").fill(pasted)
    await getPw(page, "chart-form-submit").click()

    await expect(getPw(page, "chart")).toHaveCount(1, { timeout: 10000 })
    await expect(getPw(page, "chart-name")).toContainText("written in G")
    // The sections come from the pasted headers, the lyrics from the pasted lines.
    await expect(getPw(page, "chart-section")).toHaveText(["Verse 1", "Chorus", "Verse 2", "Chorus"])
    expect(await shownLyrics(page)).toContain("Amazing grace, how sweet the sound")
    await expectChords(page, ["G", "C", "D", "Em"])

    // The song's own key is the default, so the chart opens in G, as written.
    await getPw(page, "chart-shown-key").selectOption("A")
    await expectChords(page, ["A", "D", "E", "F#m"])
    expect(await shownLyrics(page)).toContain("Amazing grace, how sweet the sound")
    await expect(page).toHaveURL(/key=A/)

    // Reloading keeps the key, and the stored chart is still the one written in G.
    await page.reload()
    await expect(getPw(page, "chart-shown-key")).toHaveValue("A")
    await expect(getPw(page, "chart-name")).toContainText("written in G")
  })

  test("a setlist entry opens the chart in the entry's key", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await createChart(page.request, songId)

    const setlist = await (
      await page.request.post("/api/setlists", {
        data: { band_id: bandId, name: "Friday", description: null, gig_date: null, status: "draft" },
      })
    ).json()
    const entry = await (
      await page.request.post(`/api/setlists/${setlist.id}/entries`, { data: { song_id: songId, position: 1 } })
    ).json()
    const updated = await page.request.put(`/api/setlists/${setlist.id}/entries/${entry.id}`, {
      data: { position: 1, section_id: null, key_override: "Bb", tempo_override: null, notes_override: null },
    })
    expect(updated.ok(), `override failed: ${await updated.text()}`).toBe(true)

    await page.goto(`/band/${bandId}/setlists/${setlist.id}`)
    await getPw(page, "entry-chart").click()

    await expect(getPw(page, "chart-shown-key")).toHaveValue("Bb", { timeout: 10000 })
    await expectChords(page, ["Bb", "Eb", "F", "Gm"])
  })

  test("reads a chart from a PDF, shows the file beside the text, and makes the chart", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-add").click()

    await getPw(page, "chart-form-file").setInputFiles(fixturePath("amazing-grace.pdf"))
    await expect(getPw(page, "chart-form-pasted")).toHaveValue(/Amazing grace, how sweet the sound/, { timeout: 10000 })
    await expect(getPw(page, "chart-form-original")).toBeVisible()
    await getPw(page, "chart-form-submit").click()

    await expect(getPw(page, "chart")).toHaveCount(1, { timeout: 10000 })
    await expect(getPw(page, "chart-section")).toHaveText(["Verse 1", "Chorus", "Verse 2", "Chorus"])
    expect(await shownLyrics(page)).toContain("That saved a wretch like me")
    await expectChords(page, ["G", "C", "D", "Em"])
  })

  test("reads the chords and lyrics of a photo of a chart", async ({ page, testing }) => {
    // Tesseract takes a few seconds on a page.
    test.setTimeout(40000)
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-add").click()

    await getPw(page, "chart-form-file").setInputFiles(fixturePath("amazing-grace.png"))
    await expect(getPw(page, "chart-form-reading")).toBeVisible()
    await expect(getPw(page, "chart-form-pasted")).toHaveValue(/Amazing grace, how sweet the sound/, { timeout: 30000 })
    // Every chord row came through with the chords of the typed chart, in order.
    const read = await getPw(page, "chart-form-pasted").inputValue()
    expect(chordRows(read)).toEqual(chordRows(pasted))
    await expect(getPw(page, "chart-form-original").locator("img")).toBeVisible()
  })

  test("refuses a file that is neither a PDF nor an image", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-add").click()

    await getPw(page, "chart-form-file").setInputFiles(fixturePath("amazing-grace.txt"))
    await expect(getPw(page, "chart-form-file-error")).toHaveText("That is not a PDF or an image")
    const res = await page.request.post("/api/charts/read", {
      headers: { "content-type": "application/octet-stream" },
      data: Buffer.from(pasted),
    })
    expect(res.status()).toBe(400)
  })

  test("keeps pasted tab as written: no chords on it, in any key, and editable as text", async ({ page, testing }) => {
    const riff = readFileSync(fixturePath("riff-and-solo.txt"), "utf8")
    const tabRows = riff.split("\n").filter((row) => row.includes("-|") || row.includes("|-"))
    await testing.login()
    const { bandId, songId } = await createSong(page)
    const res = await page.request.post("/api/charts", { data: { song_id: songId, name: "Riff", written_key: "G", pasted: riff } })
    expect(res.ok(), await res.text()).toBe(true)
    await page.goto(`/band/${bandId}/songs/${songId}`)

    // Each tab line is drawn exactly as pasted, the chord row above the intro tab with it.
    await expect(getPw(page, "chart-tab")).toHaveText(["   G                 C", ...tabRows], { useInnerText: true })
    // The only chords drawn as chords are the verse's.
    await expect(getPw(page, "chart-chord").filter({ hasText: /\S/ })).toHaveText(["G", "C", "G", "D"])
    const height = async () => (await getPw(page, "chart-tab").nth(1).boundingBox())!.height
    const lyricHeight = (await getPw(page, "chart-lyric").first().boundingBox())!.height
    // One text row: no empty chord row above it, and no wrapping.
    expect(await height()).toBeLessThan(lyricHeight * 1.5)

    await getPw(page, "chart-shown-key").selectOption("A")
    await expectChords(page, ["A", "D", "E"])
    await expect(getPw(page, "chart-tab")).toHaveText(["   G                 C", ...tabRows], { useInnerText: true })
    await expect(getPw(page, "chart-written-in").first()).toHaveText("tab as written, in G")

    await getPw(page, "chart-edit").click()
    // Tab lines offer no words to drop chords on.
    await expect(getPw(page, "editor-tab")).toHaveCount(tabRows.length + 1)
    await expect(getPw(page, "editor-tab").locator("[data-pwid=editor-segment]")).toHaveCount(0)
    const solo = getPw(page, "editor-tab").filter({ hasText: "3h5" })
    await solo.hover()
    await solo.getByRole("button", { name: "Edit tab line" }).click()
    await getPw(page, "line-input").fill("B|--3h5h7--------------|")
    await getPw(page, "line-input").press("Enter")
    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(page, "chart-tab").filter({ hasText: "3h5h7" })).toHaveText("B|--3h5h7--------------|", { useInnerText: true })
  })

  test("edit mode has a Close that returns to the chart", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await createChart(page.request, songId)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await expect(getPw(page, "chart")).toHaveCount(1, { timeout: 10000 })
    await getPw(page, "chart-edit").click()
    await expect(getPw(page, "chart-editor")).toBeVisible()
    await getPw(page, "chart-close").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0)
    await expect(getPw(page, "marked-chart")).toBeVisible()
    await expect(getPw(page, "chart-close")).toHaveCount(0)
  })

  test("deletes a chart", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await createChart(page.request, songId)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await expect(getPw(page, "chart")).toHaveCount(1, { timeout: 10000 })
    // Delete is offered only in edit mode, so the test enters it first.
    await expect(getPw(page, "chart-delete")).toHaveCount(0)
    await getPw(page, "chart-edit").click()
    await getPw(page, "chart-delete").click()
    await expect(getPw(page, "charts-empty")).toBeVisible({ timeout: 10000 })
  })

  test("a user outside the band can neither list nor add charts", async ({ page, testing }) => {
    await testing.login({ username: "test_chart_owner" })
    const { songId } = await createSong(page)
    await createChart(page.request, songId)

    await testing.login({ username: "test_chart_outsider" })
    expect((await page.request.get(`/api/charts/song/${songId}`)).status()).toBe(403)
    const add = await page.request.post("/api/charts", {
      data: { song_id: songId, name: "Mine", written_key: "G", pasted },
    })
    expect(add.status()).toBe(403)
  })
})

test.describe("chord shapes", () => {
  const shapes = "[Verse 1]\nC        F#m7add11\nAmazing  grace how sweet"

  test("a panel for a chord at the end of a line stays on the phone screen, under the chord", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    const made = await page.request.post("/api/charts", {
      data: { song_id: songId, name: "Ends", written_key: "G", pasted: "[Verse 1]\nAmazing grace how sweet the sound\n            G\nthat saved a wretch like me" },
    })
    expect(made.ok(), `create chart failed: ${await made.text()}`).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await expect(getPw(page, "chart")).toHaveCount(1, { timeout: 10000 })

    const chord = getPw(page, "chart-chord").filter({ hasText: /^G$/ }).last()
    await chord.click()
    const panel = getPw(page, "chord-shapes")
    await expect(panel).toBeVisible()
    // The page does not widen: the panel flips left of a chord at the right edge.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const box = (await panel.boundingBox())!
    const at = (await chord.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    // The panel hangs under the chord, not over the lyric.
    expect(box.y).toBeGreaterThanOrEqual(at.y + at.height - 1)
  })

  test("a tapped chord opens its guitar shapes, and no other tool opens one", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    const made = await page.request.post("/api/charts", {
      data: { song_id: songId, name: "Shapes", written_key: "G", pasted: shapes },
    })
    expect(made.ok(), `create chart failed: ${await made.text()}`).toBe(true)
    const chart = (await made.json()) as { id: string; revision_id: string; source: string }

    // `Hm` is no chord name, and a pasted chord row holds only names the paste
    // parser reads, so this one is placed on a word the way the editor places it.
    const doc = parseDoc(chart.source)
    const line = doc.findIndex((l) => l.kind === "lyrics" && l.text.startsWith("Amazing"))
    const edit = placeChord(doc, line, 17, "Hm")
    const saved = await page.request.post(`/api/charts/${chart.id}/revisions`, {
      data: { parent_id: chart.revision_id, source: serializeDoc(edit.doc), changes: edit.changes },
    })
    expect(saved.ok(), `save revision failed: ${await saved.text()}`).toBe(true)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await expect(getPw(page, "chart")).toHaveCount(1, { timeout: 10000 })

    const chord = (name: string) => getPw(page, "chart-chord").filter({ hasText: new RegExp(`^${name}$`) })
    const panel = getPw(page, "chord-shapes")

    // The panel overlays the chart: the chord stays exactly where it was.
    const beforeY = (await chord("C").boundingBox())!.y
    await chord("C").click()
    await expect(panel).toBeVisible()
    await expect(panel.getByRole("img").first()).toHaveAttribute("data-frets", "x 3 2 0 1 0")
    await expect(panel).toHaveAttribute("aria-label", "C on guitar")
    expect((await chord("C").boundingBox())!.y).toBe(beforeY)

    // One panel at a time: tapping another chord replaces it.
    await chord("F#m7add11").click()
    await expect(panel).toHaveAttribute("aria-label", "F#m7add11 on guitar")
    await expect(panel.getByRole("img").first()).toBeVisible()
    expect((await chord("C").boundingBox())!.y).toBe(beforeY)

    // Escape, and a tap on the same chord again, close it.
    await page.keyboard.press("Escape")
    await expect(panel).toHaveCount(0)
    await chord("F#m7add11").click()
    await expect(panel).toHaveCount(1)
    await chord("F#m7add11").click()
    await expect(panel).toHaveCount(0)

    // A name no hand can hold says so rather than showing nothing.
    await chord("Hm").click()
    await expect(getPw(page, "chord-shapes-none")).toHaveText("No guitar shape for Hm")
    await page.keyboard.press("Escape")
    await expect(panel).toHaveCount(0)

    // With a drawing tool up, a chord is text again and opens nothing.
    await openTool(page, "ink")
    await chord("C").click()
    await expect(panel).toHaveCount(0)
  })

  test("with the diagrams set to off, a chord is plain text and opens no panel", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    const made = await page.request.post("/api/charts", {
      data: { song_id: songId, name: "Shapes", written_key: "G", pasted: shapes },
    })
    expect(made.ok(), `create chart failed: ${await made.text()}`).toBe(true)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await expect(getPw(page, "chart")).toHaveCount(1, { timeout: 10000 })

    await getPw(page, "chart-diagrams").selectOption("off")
    const chord = getPw(page, "chart-chord").filter({ hasText: /^C$/ }).first()
    // With no shapes, a chord is not a button: it carries no expanded state.
    await expect(chord).not.toHaveAttribute("aria-expanded", /.*/)
    await chord.click()
    await expect(getPw(page, "chord-shapes")).toHaveCount(0)
  })

  test("the diagrams label every note they sound with its degree", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    const made = await page.request.post("/api/charts", {
      data: { song_id: songId, name: "Shapes", written_key: "G", pasted: shapes },
    })
    expect(made.ok(), `create chart failed: ${await made.text()}`).toBe(true)

    await page.goto(`/band/${bandId}/songs/${songId}`)
    await expect(getPw(page, "chart")).toHaveCount(1, { timeout: 10000 })
    await expect(getPw(page, "chart-diagrams")).toHaveValue("guitar")

    // C in G is the IV, so the panel names the chord's numeral under its name.
    await getPw(page, "chart-chord").filter({ hasText: /^C$/ }).first().click()
    const panel = getPw(page, "chord-shapes")
    await expect(panel).toBeVisible()
    await expect(getPw(page, "shapes-numeral")).toHaveText("IV")

    const first = getPw(page, "chord-diagram").first()
    await expect(first).toHaveAttribute("data-frets", "x 3 2 0 1 0")
    // The shape names every note it sounds, open strings included, low string to high.
    await expect(first.locator("[data-pwid=chord-degree]")).toHaveText(["R", "3", "5", "R", "3"])
  })
})

/** A chart of bare lyrics, the way a band starts one before it has any chords. */
const createBareChart = async (page: Page, songId: string) => {
  const res = await page.request.post("/api/charts", {
    data: { song_id: songId, name: "Words", written_key: "G", pasted: "[Verse 1]\nAmazing grace, how sweet\nThe sound" },
  })
  expect(res.ok(), `create chart failed: ${await res.text()}`).toBe(true)
  return (await res.json()) as { id: string; revision_id: string }
}

const segment = (page: Page, text: string) => getPw(page, "editor-segment").filter({ hasText: text })

test.describe("chart editor", () => {
  test("drops chords onto words, undoes one, and saves a revision", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await createBareChart(page, songId)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").click()

    // Drag from the palette onto a word.
    await getPw(page, "palette-chord").filter({ hasText: /^G$/ }).dragTo(segment(page, "Amazing"))
    // Or hold a chord and click a word.
    await getPw(page, "palette-chord").filter({ hasText: /^Em$/ }).click()
    await segment(page, "sweet").click()
    await segment(page, "The").click()
    await expect(getPw(page, "placed-chord")).toHaveText(["G", "Em", "Em"])

    await getPw(page, "editor-undo").click()
    await expect(getPw(page, "placed-chord")).toHaveText(["G", "Em"])

    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(page, "chart-chord").filter({ hasText: /\S/ })).toHaveText(["G", "Em"])

    // The saved revision is the chart now.
    await page.reload()
    await expect(getPw(page, "chart-chord").filter({ hasText: /\S/ })).toHaveText(["G", "Em"])
    expect(await shownLyrics(page)).toContain("Amazing grace, how sweet")
  })

  test("moves a chord to another word and removes one", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await createChart(page.request, songId)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").click()

    const before = await getPw(page, "placed-chord").count()
    const first = getPw(page, "placed-chord").first()
    // The target stays in view: a native drag does not scroll the page.
    await first.dragTo(segment(page, "saved"))
    await expect(getPw(page, "placed-chord")).toHaveCount(before)
    await expect(segment(page, "saved").locator("[data-pwid=placed-chord]")).toHaveCount(1)

    await getPw(page, "placed-chord").first().dragTo(getPw(page, "palette-remove"))
    await expect(getPw(page, "placed-chord")).toHaveCount(before - 1)
  })

  test("edits the words of a line and renames a section, keeping the chords", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await createChart(page.request, songId)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").click()

    const line = getPw(page, "editor-line").filter({ hasText: "Amazing grace, how" }).first()
    await line.hover()
    await line.getByRole("button", { name: "Edit words" }).click()
    await getPw(page, "line-input").fill("Amazing grace, how very sweet the sound")
    await getPw(page, "line-input").press("Enter")
    await expect.poll(async () => (await getPw(page, "editor-lyric").allTextContents()).join("")).toContain("how very sweet the sound")
    // The chords that were on the words around the edit are still there.
    await expect(getPw(page, "placed-chord").filter({ hasText: /^C$/ })).not.toHaveCount(0)

    await getPw(page, "editor-section").first().click()
    await getPw(page, "section-input").fill("Verse One")
    await getPw(page, "section-input").press("Enter")
    await getPw(page, "editor-save").click()

    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(page, "chart-section").first()).toHaveText("Verse One")
    expect(await shownLyrics(page)).toContain("how very sweet the sound")
  })

  test("adds, moves and removes a section in the editor", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await createChart(page.request, songId)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").click()
    const headings = () => getPw(page, "editor-section").allTextContents()
    await expect.poll(headings).toEqual(["Verse 1", "Chorus", "Verse 2", "Chorus"])

    // Start a section on a line inside the first verse: it splits in two.
    const line = getPw(page, "editor-line").filter({ hasText: "Was blin" }).first()
    await line.hover()
    await line.getByRole("button", { name: "Start a section here" }).click()
    await getPw(page, "new-section-input").fill("Bridge")
    await getPw(page, "new-section-input").press("Enter")
    await expect.poll(headings).toEqual(["Verse 1", "Bridge", "Chorus", "Verse 2", "Chorus"])

    // Move the bridge below the chorus, then take the heading away again.
    const bridge = () => getPw(page, "editor-section").filter({ hasText: "Bridge" }).locator("xpath=..")
    await bridge().hover()
    await bridge().getByRole("button", { name: "Move section down" }).click()
    await expect.poll(headings).toEqual(["Verse 1", "Chorus", "Bridge", "Verse 2", "Chorus"])
    await bridge().hover()
    await bridge().getByRole("button", { name: "Remove section" }).click()
    await expect.poll(headings).toEqual(["Verse 1", "Chorus", "Verse 2", "Chorus"])

    // Saving keeps the words; the chart draws the same sections.
    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(page, "chart-section")).toHaveText(["Verse 1", "Chorus", "Verse 2", "Chorus"])
    expect(await shownLyrics(page)).toContain("Was blind, but now I see")
  })

  test("copies a chart as chords over lyrics in the shown key, and pasting it back makes the same chart", async ({ page, context, testing }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await createChart(page.request, songId)
    await page.goto(`/band/${bandId}/songs/${songId}?key=A`)
    await expect(getPw(page, "chart-section").first()).toBeVisible({ timeout: 10000 })

    await getPw(page, "chart-copy").click()
    await expect(getPw(page, "chart-copy")).toHaveText("Copied")
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied.split("\n")[0]).toBe("[Verse 1]")
    expect(copied).toContain("Amazing grace, how sweet the sound")
    expect(copied).toMatch(/^A +D +A$/m)

    // Adding the copy as a new chart in A shows the same chords and words.
    await getPw(page, "chart-add").click()
    await getPw(page, "chart-form-key").selectOption("A")
    await getPw(page, "chart-form-pasted").fill(copied)
    await getPw(page, "chart-form-submit").click()
    await expect(getPw(page, "chart")).toHaveCount(2, { timeout: 10000 })
    const [first, second] = await getPw(page, "chart").all()
    expect(await first!.locator("[data-pwid=chart-lyric]").allTextContents()).toEqual(await second!.locator("[data-pwid=chart-lyric]").allTextContents())
    expect(await first!.locator("[data-pwid=chart-chord]").allTextContents()).toEqual(await second!.locator("[data-pwid=chart-chord]").allTextContents())
  })

  test("saves a revision the editor could have made, and refuses a stale or unexplained one", async ({ page, testing }) => {
    await testing.login()
    const { songId } = await createSong(page)
    const chart = await createBareChart(page, songId)
    const stored = ((await (await page.request.get(`/api/charts/song/${songId}`)).json()) as Array<{ source: string }>)[0]!.source
    const doc = parseDoc(stored)
    const line = doc.findIndex((l) => l.kind === "lyrics" && l.text.startsWith("Amazing"))
    const edit = placeChord(doc, line, 0, "G")
    const save = (parent: string, source: string, changes: ReadonlyArray<Change> | null) =>
      page.request.post(`/api/charts/${chart.id}/revisions`, { data: { parent_id: parent, source, changes } })

    // The text changed but the change set says nothing did.
    expect((await save(chart.revision_id, serializeDoc(edit.doc), [])).status()).toBe(400)
    // A change set that fits the edit is stored as the chart's new revision.
    const saved = await save(chart.revision_id, serializeDoc(edit.doc), edit.changes)
    expect(saved.status()).toBe(201)
    // The same save again names a parent that is no longer the newest.
    expect((await save(chart.revision_id, serializeDoc(edit.doc), edit.changes)).status()).toBe(409)

    // A text edit with no change set is stored as well: a reader derives one when it follows a mark.
    const typed = serializeDoc(edit.doc).replace("Amazing grace", "Amazing grace!")
    const parent = ((await saved.json()) as { revision_id: string }).revision_id
    expect((await save(parent, typed, null)).status()).toBe(201)
  })
})

test.describe("phrases", () => {
  const riff = ":8 0.6 3.6 5.5 3.5 | 5.5 3.5 0.5 5.6"

  test("writes a phrase under a line, draws it as it is typed, and keeps it in the chart", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page, 100)
    await createBareChart(page, songId)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").click()

    const line = getPw(page, "editor-line").filter({ hasText: "Amazing grace" })
    await line.hover()
    await line.getByRole("button", { name: "Add a phrase below" }).click()
    const form = getPw(page, "phrase-form")
    await getPw(page, "phrase-name").fill("Intro riff")
    // Notation alphaTab cannot read says where, and cannot be kept.
    await getPw(page, "phrase-tex").fill(":8 0.6 zz.qq")
    await expect(form.locator("[data-pwid=phrase-problems]")).toContainText("Line 1, column 11")
    await expect(getPw(page, "phrase-save")).toBeDisabled()
    await getPw(page, "phrase-tex").fill(riff)
    await expect(form.locator("[data-pwid=phrase]")).toHaveAttribute("data-rendered", "true", { timeout: 15000 })
    await expect(form.locator("[data-pwid=phrase-problems]")).toHaveCount(0)
    await getPw(page, "phrase-save").click()

    await expect(getPw(page, "editor-phrase")).toContainText("Intro riff")
    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })

    const phrase = getPw(page, "chart-phrase")
    await expect(phrase).toContainText("Intro riff")
    await expect(phrase.locator("[data-pwid=phrase]")).toHaveAttribute("data-rendered", "true", { timeout: 15000 })
    await expect(phrase.locator("svg").first()).toBeVisible()
    // The phrase sits between the line it was written under and the rest of the verse.
    await expect.poll(() => shownLyrics(page)).toBe("Amazing grace, how sweetThe sound")
    // The speeds are worked out from the song's tempo.
    await expect(phrase.locator("[data-pwid=phrase-speed] option").first()).toHaveText("50% (50 bpm)")

    await getPw(page, "chart-shown-key").selectOption("A")
    await expect(getPw(page, "chart-written-in")).toHaveText("notation as written, in G")

    await page.reload()
    await expect(getPw(page, "chart-phrase")).toContainText("Intro riff")
  })

  test("plays a phrase, starting the player on the first Play", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page, 100)
    await createBareChart(page, songId)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").click()
    const line = getPw(page, "editor-line").filter({ hasText: "Amazing grace" })
    await line.hover()
    await line.getByRole("button", { name: "Add a phrase below" }).click()
    await getPw(page, "phrase-name").fill("Lick")
    await getPw(page, "phrase-tex").fill(riff)
    await getPw(page, "phrase-save").click()
    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })

    await getPw(page, "phrase-loop").check()
    const play = getPw(page, "phrase-play")
    await play.click()
    // The first Play waits for the sound font, a download of about 1 MB.
    await expect(play).toHaveText("Stop", { timeout: 30000 })
    // alphaTab throws if it is stopped before its audio output has started.
    await page.waitForTimeout(500)
    await play.click()
    await expect(play).toHaveText("Play")
  })

  test("changes a phrase's notation and removes it", async ({ page, testing }) => {
    await testing.login()
    const { bandId, songId } = await createSong(page)
    await createBareChart(page, songId)
    await page.goto(`/band/${bandId}/songs/${songId}`)
    await getPw(page, "chart-edit").click()
    const line = getPw(page, "editor-line").filter({ hasText: "Amazing grace" })
    await line.hover()
    await line.getByRole("button", { name: "Add a phrase below" }).click()
    await getPw(page, "phrase-name").fill("Lick")
    await getPw(page, "phrase-tex").fill(riff)
    await getPw(page, "phrase-save").click()

    const block = getPw(page, "editor-phrase")
    await block.hover()
    await block.getByRole("button", { name: "Edit phrase" }).click()
    await expect(getPw(page, "phrase-tex")).toHaveValue(riff)
    await getPw(page, "phrase-name").fill("Fill")
    await getPw(page, "phrase-tex").fill(":4 C4 D4 E4 G4")
    await getPw(page, "phrase-save").click()
    await expect(getPw(page, "editor-phrase")).toContainText("Fill")
    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(page, "chart-phrase")).toContainText("Fill")

    await getPw(page, "chart-edit").click()
    await getPw(page, "editor-phrase").hover()
    await getPw(page, "editor-phrase").getByRole("button", { name: "Remove phrase" }).click()
    await expect(getPw(page, "editor-phrase")).toHaveCount(0)
    await getPw(page, "editor-save").click()
    await expect(getPw(page, "chart-editor")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(page, "chart-phrase")).toHaveCount(0)
    expect(await shownLyrics(page)).toBe("Amazing grace, how sweetThe sound")
  })
})
