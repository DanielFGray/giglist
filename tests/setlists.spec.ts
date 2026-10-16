import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

const createBand = async (page: import("@playwright/test").Page, slug: string) => {
  const res = await page.request.post("/api/my/bands", {
    data: { slug, name: `Test: ${slug}` },
  })
  expect(res.ok(), `create band failed: ${await res.text()}`).toBe(true)
  const band = await res.json()
  return band.id as string
}

const createSong = async (
  page: import("@playwright/test").Page,
  bandId: string,
  title: string,
) => {
  const res = await page.request.post("/api/songs", {
    data: {
      band_id: bandId,
      title,
      artist: null,
      key: null,
      tempo_bpm: null,
      duration_seconds: null,
      capo: null,
      notes: null,
    },
  })
  expect(res.ok(), `create song failed: ${await res.text()}`).toBe(true)
  const song = await res.json()
  return song.id as string
}

test.describe("setlists", () => {
  test("builds a setlist: add, reorder, override, remove", async ({
    page,
    testing,
  }) => {
    await testing.login()
    const bandId = await createBand(page, `test-setlist-${Date.now()}`)
    await createSong(page, bandId, "Alpha")
    await createSong(page, bandId, "Beta")

    await page.goto(`/band/${bandId}/setlists`)
    await expect(getPw(page, "setlists-empty")).toBeVisible({ timeout: 10000 })

    await getPw(page, "setlist-name").fill("Friday Gig")
    await getPw(page, "setlist-date").fill("2026-11-01")
    await getPw(page, "setlist-submit").click()

    await expect(getPw(page, "setlist-row")).toHaveCount(1, { timeout: 10000 })
    await expect(getPw(page, "setlist-row-name")).toHaveText("Friday Gig")

    await getPw(page, "setlist-row").click()
    await expect(getPw(page, "setlist-entries-empty")).toBeVisible({ timeout: 10000 })

    await getPw(page, "song-picker").selectOption({ label: "Alpha" })
    await getPw(page, "song-picker-add").click()
    await expect(getPw(page, "setlist-entry")).toHaveCount(1, { timeout: 10000 })

    await getPw(page, "song-picker").selectOption({ label: "Beta" })
    await getPw(page, "song-picker-add").click()
    await expect(getPw(page, "setlist-entry")).toHaveCount(2, { timeout: 10000 })
    await expect(getPw(page, "entry-title").first()).toHaveText("Alpha")

    // The second entry moves up, swapping the two positions.
    await getPw(page, "entry-up").nth(1).click()
    await expect(getPw(page, "entry-title").first()).toHaveText("Beta", { timeout: 10000 })

    // Override the first entry's key and tempo for this setlist only.
    await getPw(page, "entry-edit").first().click()
    await getPw(page, "override-key").selectOption("Am")
    await getPw(page, "override-tempo").fill("95")
    await getPw(page, "override-save").click()
    const first = getPw(page, "setlist-entry").first()
    await expect(first).toContainText("Am", { timeout: 10000 })
    await expect(first).toContainText("95 BPM")
    await expect(first).toContainText("overridden")

    await getPw(page, "entry-remove").first().click()
    await expect(getPw(page, "setlist-entry")).toHaveCount(1, { timeout: 10000 })

    await getPw(page, "setlist-delete").click()
    await expect(getPw(page, "setlists-empty")).toBeVisible({ timeout: 10000 })
  })

  test("keeps a setlist and its entries private to the band", async ({
    page,
    testing,
    request,
  }) => {
    await testing.login()
    const bandId = await createBand(page, `test-setlist-authz-${Date.now()}`)

    const created = await page.request.post("/api/setlists", {
      data: { band_id: bandId, name: "Private", description: null, gig_date: null, status: "draft" },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const setlist = await created.json()

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
})
