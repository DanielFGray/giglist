import type { Page } from "@playwright/test"
import { test, expect, getPw, post, TEST_PASSWORD } from "./helpers"

/** `YYYY-MM-DD`, `days` from today. */
const dayFromToday = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const createBand = async (page: Page, slug: string) => (await post(page, "/api/my/bands", { slug, name: `Test: ${slug}` })).id as string

const gigFields = { gig_date: null, address: null, load_in_time: null, performance_time: null, notes: null }

const setlistNames = (page: Page) => getPw(page, "gig-setlist-name")

test.describe("gigs", () => {
  test("creates a gig, adds an existing setlist and a new one, orders them and saves the details", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-gig-${Date.now()}`)
    const song = await post(page, "/api/songs", { band_id: bandId, title: "Alpha", artist: null, key: null, tempo_bpm: null, duration_seconds: 180, capo: null, notes: null })
    const main = await post(page, "/api/setlists", { band_id: bandId, name: "Main set" })
    await post(page, `/api/setlists/${main.id}/entries`, { song_id: song.id })

    await page.goto(`/band/${bandId}/gigs`)
    await expect(getPw(page, "gigs-empty")).toBeVisible({ timeout: 10000 })
    await getPw(page, "gig-venue").fill("The Echo Room")
    await getPw(page, "gig-date").fill(dayFromToday(10))
    await getPw(page, "gig-submit").click()
    await expect(getPw(page, "gig-label")).toHaveText("The Echo Room", { timeout: 10000 })
    await expect(getPw(page, "gig-setlists-empty")).toBeVisible()

    // Picking a listed setlist adds it at once.
    await getPw(page, "gig-add-setlist-name").fill("mai")
    await getPw(page, "gig-add-setlist-option").filter({ hasText: "Main set" }).click()
    await expect(setlistNames(page)).toHaveText(["Main set"], { timeout: 10000 })
    await expect(getPw(page, "gig-summary")).toContainText("1 song · 3:00")

    // A name no setlist has makes a new, empty setlist and adds it after.
    await getPw(page, "gig-add-setlist-name").fill("Encore")
    await getPw(page, "gig-add-setlist-name").press("Enter")
    await expect(setlistNames(page)).toHaveText(["Main set", "Encore"], { timeout: 10000 })

    await getPw(page, "gig-setlist-up").nth(1).click()
    await expect(setlistNames(page)).toHaveText(["Encore", "Main set"], { timeout: 10000 })

    // The setlist's page names the gigs that play it.
    await setlistNames(page).nth(1).click()
    await expect(getPw(page, "setlist-gig")).toHaveText(["The Echo Room"], { timeout: 10000 })
    await getPw(page, "setlist-gig").click()

    await getPw(page, "gig-load-in").fill("18:30")
    await getPw(page, "gig-performance").fill("20:00")
    await getPw(page, "gig-address-field").fill("123 Main St")
    await getPw(page, "gig-notes").fill("Parking round back")
    await getPw(page, "gig-save").click()
    await expect(getPw(page, "gig-summary")).toContainText("Load-in 6:30 PM · Performance 8:00 PM", { timeout: 10000 })
    await expect(getPw(page, "gig-address")).toHaveText("123 Main St")
    await page.reload()
    await expect(getPw(page, "gig-notes")).toHaveValue("Parking round back", { timeout: 10000 })
    await expect(setlistNames(page)).toHaveText(["Encore", "Main set"])

    // Removing a setlist from the gig keeps the setlist.
    await getPw(page, "gig-setlist-remove").first().click()
    await expect(setlistNames(page)).toHaveText(["Main set"], { timeout: 10000 })
    const all = (await (await page.request.get(`/api/setlists/band/${bandId}`)).json()) as Array<{ name: string }>
    expect(all.map((s) => s.name).sort()).toEqual(["Encore", "Main set"])

    // With no venue, the gig goes by its date.
    await getPw(page, "gig-venue").fill("")
    await getPw(page, "gig-save").click()
    await expect(getPw(page, "gig-label")).not.toHaveText("The Echo Room", { timeout: 10000 })
  })

  test("one setlist serves many gigs, and one gig copies it for itself in the same place", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-gig-reuse-${Date.now()}`)
    const song = await post(page, "/api/songs", { band_id: bandId, title: "Alpha", artist: null, key: null, tempo_bpm: null, duration_seconds: null, capo: null, notes: null })
    const main = await post(page, "/api/setlists", { band_id: bandId, name: "Main set" })
    await post(page, `/api/setlists/${main.id}/entries`, { song_id: song.id })
    const opener = await post(page, "/api/setlists", { band_id: bandId, name: "Opener" })
    const friday = await post(page, "/api/gigs", { band_id: bandId, ...gigFields, venue: "Friday", gig_date: dayFromToday(5) })
    const saturday = await post(page, "/api/gigs", { band_id: bandId, ...gigFields, venue: "Saturday", gig_date: dayFromToday(6) })
    await post(page, `/api/gigs/${saturday.id}/setlists`, { setlist_id: opener.id })

    // From the setlist's page, it joins one gig after another.
    await page.goto(`/band/${bandId}/setlists/${main.id}`)
    await getPw(page, "setlist-add-gig").selectOption({ label: "Friday" })
    await expect(getPw(page, "setlist-gig")).toHaveText(["Friday"], { timeout: 10000 })
    await getPw(page, "setlist-add-gig").selectOption({ label: "Saturday" })
    await expect(getPw(page, "setlist-gig")).toHaveText(["Friday", "Saturday"], { timeout: 10000 })
    await expect(getPw(page, "setlist-add-gig")).toHaveCount(0)

    // Saturday shows the list as shared, and makes its own copy where the original stood.
    await getPw(page, "setlist-gig").filter({ hasText: "Saturday" }).click()
    await expect(setlistNames(page)).toHaveText(["Opener", "Main set"], { timeout: 10000 })
    await expect(getPw(page, "gig-setlist-shared")).toHaveText([" · Also in 1 other gig"])
    await expect(getPw(page, "gig-setlist-copy")).toHaveCount(1)
    await getPw(page, "gig-setlist-copy").click()
    await expect(getPw(page, "gig-copy-name")).toBeFocused()
    await expect(getPw(page, "gig-copy-name")).toHaveValue("Main set (Saturday)")
    await page.keyboard.press("Enter")
    await expect(setlistNames(page)).toHaveText(["Opener", "Main set (Saturday)"], { timeout: 10000 })
    await expect(getPw(page, "gig-setlist-shared")).toHaveCount(0)
    await expect(getPw(page, "gig-copy-panel")).toHaveCount(0)
    await expect(getPw(page, "gig-setlist").nth(1)).toContainText("1 song")

    // The copy is Saturday's alone: a song added to it does not reach Friday.
    const copy = ((await (await page.request.get(`/api/gigs/${saturday.id}`)).json()) as { setlists: Array<{ id: string }> }).setlists[1]!
    await post(page, `/api/setlists/${copy.id}/entries`, { song_id: song.id })
    await page.goto(`/band/${bandId}/gigs/${friday.id}`)
    await expect(getPw(page, "gig-setlist")).toContainText(/Main set.*1 song/, { timeout: 10000 })
    await page.goto(`/band/${bandId}/setlists/${main.id}`)
    await expect(getPw(page, "setlist-gig")).toHaveText(["Friday"], { timeout: 10000 })
  })

  test("lists upcoming gigs soonest first and past gigs latest first, and deletes a gig", async ({ page, testing }) => {
    await testing.login()
    const bandId = await createBand(page, `test-gig-list-${Date.now()}`)
    for (const [venue, days] of [["Later", 20], ["Sooner", 5], ["Long ago", -60], ["Last week", -7]] as const) {
      await post(page, "/api/gigs", { band_id: bandId, ...gigFields, venue, gig_date: dayFromToday(days) })
    }
    await page.goto(`/band/${bandId}/gigs`)
    await expect(getPw(page, "gigs-upcoming").locator('[data-pwid="gig-row-label"]')).toHaveText(["Sooner", "Later"], { timeout: 10000 })
    await expect(getPw(page, "gigs-past").locator('[data-pwid="gig-row-label"]')).toHaveText(["Last week", "Long ago"])

    await getPw(page, "gig-row").filter({ hasText: "Later" }).click()
    await getPw(page, "gig-delete").click()
    await expect(getPw(page, "gigs-upcoming").locator('[data-pwid="gig-row-label"]')).toHaveText(["Sooner"], { timeout: 10000 })
  })

  test("keeps a gig private to the band", async ({ page, testing, request }) => {
    await testing.login()
    const bandId = await createBand(page, `test-gig-authz-${Date.now()}`)
    const gig = await post(page, "/api/gigs", { band_id: bandId, ...gigFields, venue: "Private" })

    const username = `test_gig_outsider_${Date.now()}`
    const registered = await request.post("/api/auth/register", {
      data: { username, email: `${username}@test.local`, password: TEST_PASSWORD },
    })
    expect(registered.ok(), await registered.text()).toBe(true)
    expect((await request.get(`/api/gigs/${gig.id}`)).status()).toBe(404)
    expect((await request.get(`/api/gigs/band/${bandId}`)).status()).toBe(403)
  })
})
