import type { Page } from "@playwright/test"
import { test, expect, getPw, post, TEST_PASSWORD } from "./helpers"

const createBand = async (page: Page, slug: string) => (await post(page, "/api/my/bands", { slug, name: `Test: ${slug}` })).id as string

const createSong = async (page: Page, bandId: string, title: string, fields: { artist?: string; key?: string; tempo_bpm?: number; duration_seconds?: number } = {}) =>
  (await post(page, "/api/songs", {
    band_id: bandId, title, artist: null, key: null, tempo_bpm: null, duration_seconds: null, capo: null, notes: null, ...fields,
  })).id as string

/** The setlist grid's rows, and one column of them. */
const rows = (page: Page) => getPw(page, "setlist-grid").locator('[data-pwid="grid-row"]')
const column = (page: Page, key: string) => rows(page).locator(`[data-pwid="cell-${key}"]`)

test.describe("setlists", () => {
  test("the song picker leaves out songs already in the list, so its choices shrink", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-setlist-pick-${Date.now()}`)
    await createSong(page, bandId, "Alpha")
    await createSong(page, bandId, "Alto")

    await page.goto(`/band/${bandId}/setlists`)
    await getPw(page, "setlist-form-name").fill("Pick")
    await getPw(page, "setlist-form-submit").click()
    await expect(getPw(page, "setlist-label")).toHaveValue("Pick", { timeout: 10000 })

    await getPw(page, "grid-new-row").locator('[data-pwid="cell-title"]').click()
    await page.keyboard.type("al")
    await expect(getPw(page, "grid-choice")).toHaveText([/^Alpha/, /^Alto/])
    await page.keyboard.press("Enter")
    await expect(column(page, "title")).toHaveText(["Alpha"], { timeout: 10000 })
    await page.keyboard.type("al")
    await expect(getPw(page, "grid-choice")).toHaveText([/^Alto/])
  })

  test("builds a setlist in the grid: pick songs by typing, override this list only, move and remove by keyboard", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-setlist-${Date.now()}`)
    await createSong(page, bandId, "Alpha", { artist: "The As", key: "G", tempo_bpm: 120, duration_seconds: 100 })
    await createSong(page, bandId, "Beta", { artist: "The Bs", duration_seconds: 200 })
    await createSong(page, bandId, "Gamma", { duration_seconds: 60 })

    await page.goto(`/band/${bandId}/setlists`)
    await expect(getPw(page, "setlists-empty")).toBeVisible({ timeout: 10000 })
    await getPw(page, "setlist-form-name").fill("Main set")
    await getPw(page, "setlist-form-submit").click()
    await expect(getPw(page, "setlist-label")).toHaveValue("Main set", { timeout: 10000 })

    // The song column offers the catalog's songs that match what is typed; Enter takes the first.
    await getPw(page, "grid-new-row").locator('[data-pwid="cell-title"]').click()
    await page.keyboard.type("al")
    await expect(getPw(page, "grid-choice")).toHaveText([/^Alpha/])
    await page.keyboard.press("Enter")
    await expect(column(page, "title")).toHaveText(["Alpha"], { timeout: 10000 })
    await page.keyboard.type("Beta")
    await page.keyboard.press("Enter")
    await page.keyboard.type("Gamma")
    await page.keyboard.press("Enter")
    await expect(column(page, "title")).toHaveText(["Alpha", "Beta", "Gamma"], { timeout: 10000 })
    // A title not in the catalog adds nothing: the editor stays open until Escape.
    await page.keyboard.type("Nowhere")
    await page.keyboard.press("Enter")
    await expect(getPw(page, "grid-editor")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(rows(page)).toHaveCount(3)

    // The song's own columns show, and only this list's columns take typing.
    await expect(column(page, "artist")).toHaveText(["The As", "The Bs", ""])
    await expect(getPw(page, "setlist-summary")).toContainText("3 songs · 6:00")
    await column(page, "artist").first().click()
    await page.keyboard.type("x")
    await expect(getPw(page, "grid-editor")).toHaveCount(0)

    // Overrides: Alpha in Am at 95 for this list; the song keeps its own key.
    await page.keyboard.press("ArrowRight")
    await page.keyboard.type("Am")
    await page.keyboard.press("Tab")
    await page.keyboard.type("95")
    await page.keyboard.press("Enter")
    await expect(column(page, "key").first()).toHaveText("Am", { timeout: 10000 })
    await expect(column(page, "tempo").first()).toHaveText("95")
    const song = (await (await page.request.get(`/api/songs/band/${bandId}`)).json()) as Array<{ title: string; key: string | null }>
    expect(song.find((s) => s.title === "Alpha")?.key).toBe("G")
    // Clearing an override goes back to the song's value.
    await column(page, "tempo").first().click()
    await page.keyboard.press("Delete")
    await expect(column(page, "tempo").first()).toHaveText("120", { timeout: 10000 })

    // Alt+Down moves the focused song; the order survives a reload.
    await column(page, "title").first().click()
    await page.keyboard.press("Alt+ArrowDown")
    await expect(column(page, "title")).toHaveText(["Beta", "Alpha", "Gamma"], { timeout: 10000 })
    await page.reload()
    await expect(column(page, "title")).toHaveText(["Beta", "Alpha", "Gamma"], { timeout: 10000 })

    // Ctrl+Delete removes the focused song, and Remove removes a song by its button.
    await column(page, "title").last().click()
    await page.keyboard.press("Control+Delete")
    await expect(column(page, "title")).toHaveText(["Beta", "Alpha"], { timeout: 10000 })
    await getPw(page, "entry-remove").first().click()
    await expect(column(page, "title")).toHaveText(["Alpha"], { timeout: 10000 })
  })

  test("renames a setlist, sets its status, copies it and deletes it", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-setlist-copy-${Date.now()}`)
    const songId = await createSong(page, bandId, "Alpha")
    const setlist = await post(page, "/api/setlists", { band_id: bandId, name: "Main set" })
    const entry = await post(page, `/api/setlists/${setlist.id}/entries`, { song_id: songId })
    const override = await page.request.put(`/api/setlists/${setlist.id}/entries/${entry.id}`, { data: { key_override: "D" } })
    expect(override.ok(), await override.text()).toBe(true)

    await page.goto(`/band/${bandId}/setlists/${setlist.id}`)
    // Each save must reach the server before the page is left.
    const saved = () => page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith(`/api/setlists/${setlist.id}`))
    await getPw(page, "setlist-label").fill("Long set")
    await Promise.all([saved(), getPw(page, "setlist-label").press("Enter")])
    await Promise.all([saved(), getPw(page, "setlist-status").selectOption("final")])
    await page.goto(`/band/${bandId}/setlists`)
    await expect(getPw(page, "setlist-row-label")).toHaveText(["Long set"], { timeout: 10000 })
    await expect(getPw(page, "setlist-row")).toContainText("In no gig")
    await expect(getPw(page, "setlist-status-badge")).toHaveText("final")

    // A copy keeps the songs and their overrides, and opens on its own page.
    await getPw(page, "setlist-row").click()
    await expect(getPw(page, "setlist-copy-name")).toHaveValue("Long set (copy)", { timeout: 10000 })
    await getPw(page, "setlist-copy-name").fill("Short set")
    await getPw(page, "setlist-copy-submit").click()
    await expect(getPw(page, "setlist-label")).toHaveValue("Short set", { timeout: 10000 })
    await expect(column(page, "key")).toHaveText(["D"], { timeout: 10000 })
    await expect(page).not.toHaveURL(new RegExp(setlist.id))

    await getPw(page, "setlist-delete").click()
    await expect(getPw(page, "setlist-row-label")).toHaveText(["Long set"], { timeout: 10000 })
  })

  test("keeps a setlist and its entries private to the band", async ({ page, testing, request }) => {
    await testing.login()
    const bandId = await createBand(page, `test-setlist-authz-${Date.now()}`)
    const setlist = await post(page, "/api/setlists", { band_id: bandId, name: "Private" })

    // A second user, in its own cookie store, must not reach the first band.
    const username = `test_setlist_outsider_${Date.now()}`
    const registered = await request.post("/api/auth/register", {
      data: { username, email: `${username}@test.local`, password: TEST_PASSWORD },
    })
    expect(registered.ok(), await registered.text()).toBe(true)

    const read = await request.get(`/api/setlists/${setlist.id}`)
    expect(read.status(), "outsider read another band's setlist").toBe(404)
    const list = await request.get(`/api/setlists/band/${bandId}`)
    expect(list.status(), "outsider listed another band's setlists").toBe(403)
  })

  test("refuses a move that names another setlist's entry", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-setlist-move-${Date.now()}`)
    const songId = await createSong(page, bandId, "Alpha")
    const [one, other] = [
      await post(page, "/api/setlists", { band_id: bandId, name: "One" }),
      await post(page, "/api/setlists", { band_id: bandId, name: "Other" }),
    ]
    const entry = await post(page, `/api/setlists/${other.id}/entries`, { song_id: songId })
    const res = await page.request.put(`/api/setlists/${one.id}/move`, { data: { id: entry.id, previous: null } })
    expect(res.status()).toBe(403)
  })
})
