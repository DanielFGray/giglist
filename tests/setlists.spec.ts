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
  durationSeconds: number | null = null,
) => {
  const res = await page.request.post("/api/songs", {
    data: {
      band_id: bandId,
      title,
      artist: null,
      key: null,
      tempo_bpm: null,
      duration_seconds: durationSeconds,
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


/** The groups as drawn, e.g. `["Set 1:Alpha,Beta", ":Gamma"]`; the unsectioned group has an empty name. */
const layout = (page: import("@playwright/test").Page) =>
  getPw(page, "setlist-group").evaluateAll((groups) =>
    groups.map(
      (g) =>
        `${(g as HTMLElement).dataset.section}:${[...g.querySelectorAll("[data-pwid=entry-title]")].map((t) => t.textContent).join(",")}`,
    ),
  )

const expectLayout = (page: import("@playwright/test").Page, expected: ReadonlyArray<string>) =>
  expect.poll(() => layout(page), { timeout: 10000 }).toEqual(expected)

const addSection = async (page: import("@playwright/test").Page, name: string) => {
  await getPw(page, "section-add-name").fill(name)
  await getPw(page, "section-add").click()
  await expect(getPw(page, "section-name").filter({ hasText: "" }).last()).toHaveValue(name, { timeout: 10000 })
}

const addSong = async (page: import("@playwright/test").Page, title: string) => {
  await getPw(page, "song-picker").selectOption({ label: title })
  await getPw(page, "song-picker-add").click()
  await expect(getPw(page, "entry-title").filter({ hasText: title })).toHaveCount(1, { timeout: 10000 })
}

test.describe("setlist sections", () => {
  const openSetlist = async (page: import("@playwright/test").Page, testing: { login: () => Promise<unknown> }) => {
    await testing.login()
    const bandId = await createBand(page, `test-sections-${Date.now()}`)
    await createSong(page, bandId, "Alpha", 100)
    await createSong(page, bandId, "Beta", 200)
    await createSong(page, bandId, "Gamma", 60)
    const created = await page.request.post("/api/setlists", {
      data: { band_id: bandId, name: "Sections", description: null, gig_date: null, status: "draft" },
    })
    const setlist = await created.json()
    await page.goto(`/band/${bandId}/setlists/${setlist.id}`)
    await expect(getPw(page, "song-picker")).toBeVisible({ timeout: 10000 })
    return { bandId, setlistId: setlist.id as string }
  }

  test("groups songs under sections, with a subtotal for each", async ({ page, testing }) => {
    await openSetlist(page, testing)
    await addSection(page, "Set 1")
    await addSong(page, "Alpha")
    await addSong(page, "Beta")
    await addSection(page, "Encore")
    await addSong(page, "Gamma")

    // A new song joins the last section.
    await expectLayout(page, ["Set 1:Alpha,Beta", "Encore:Gamma"])
    await expect(getPw(page, "section-duration")).toHaveText(["5:00", "1:00"])
  })

  test("drags a song to another section, and the order survives a reload", async ({ page, testing }) => {
    // Native drag does not scroll the page, so every drop target must be on screen.
    await page.setViewportSize({ width: 1280, height: 1600 })
    await openSetlist(page, testing)
    await addSection(page, "Set 1")
    await addSong(page, "Alpha")
    await addSong(page, "Beta")
    await addSection(page, "Encore")
    await addSong(page, "Gamma")

    // Drop Alpha on Gamma: it lands before it, in the Encore.
    await getPw(page, "setlist-entry").filter({ hasText: "Alpha" }).dragTo(getPw(page, "setlist-entry").filter({ hasText: "Gamma" }), { sourcePosition: { x: 40, y: 12 } })
    await expectLayout(page, ["Set 1:Beta", "Encore:Alpha,Gamma"])

    // Drop Beta on the end of the Encore group: it lands last.
    await getPw(page, "setlist-entry").filter({ hasText: "Beta" }).dragTo(getPw(page, "group-end").nth(1), { sourcePosition: { x: 40, y: 12 } })
    await expectLayout(page, ["Set 1:", "Encore:Alpha,Gamma,Beta"])

    await page.reload()
    await expectLayout(page, ["Set 1:", "Encore:Alpha,Gamma,Beta"])
  })

  test("the arrow buttons cross section boundaries", async ({ page, testing }) => {
    await openSetlist(page, testing)
    await addSection(page, "Set 1")
    await addSong(page, "Alpha")
    await addSong(page, "Beta")
    await addSection(page, "Encore")
    await addSong(page, "Gamma")

    // Beta is last in Set 1; down puts it first in the Encore.
    await getPw(page, "setlist-entry").filter({ hasText: "Beta" }).locator("[data-pwid=entry-down]").click()
    await expectLayout(page, ["Set 1:Alpha", "Encore:Beta,Gamma"])
    await getPw(page, "setlist-entry").filter({ hasText: "Beta" }).locator("[data-pwid=entry-up]").click()
    await expectLayout(page, ["Set 1:Alpha,Beta", "Encore:Gamma"])
  })

  test("renames, reorders and deletes sections; a deleted section's songs stay in the setlist", async ({ page, testing }) => {
    await openSetlist(page, testing)
    await addSection(page, "Set 1")
    await addSong(page, "Alpha")
    await addSection(page, "Encore")
    await addSong(page, "Gamma")

    await getPw(page, "section-name").first().fill("Opening")
    await getPw(page, "section-name").first().press("Enter")
    await expectLayout(page, ["Opening:Alpha", "Encore:Gamma"])

    await getPw(page, "section-up").nth(1).click()
    await expectLayout(page, ["Encore:Gamma", "Opening:Alpha"])

    await getPw(page, "section-delete").first().click()
    await expectLayout(page, [":Gamma", "Opening:Alpha"])
    await expect(getPw(page, "setlist-entry")).toHaveCount(2)

    await page.reload()
    await expectLayout(page, [":Gamma", "Opening:Alpha"])
  })

  test("refuses an arrangement that names another setlist's entry", async ({ page, testing }) => {
    const { bandId, setlistId } = await openSetlist(page, testing)
    const other = await (
      await page.request.post("/api/setlists", {
        data: { band_id: bandId, name: "Other", description: null, gig_date: null, status: "draft" },
      })
    ).json()
    const songs = (await (await page.request.get(`/api/songs/band/${bandId}`)).json()) as Array<{ id: string }>
    const entry = await (
      await page.request.post(`/api/setlists/${other.id}/entries`, { data: { song_id: songs[0]!.id, position: 1000 } })
    ).json()

    const res = await page.request.put(`/api/setlists/${setlistId}/arrangement`, {
      data: { groups: [{ section_id: null, entries: [entry.id] }] },
    })
    expect(res.status()).toBe(403)
  })
})
