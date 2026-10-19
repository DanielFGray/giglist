import { test, expect, getPw } from "./helpers"

test.describe("public band profile", () => {
  test.describe.configure({ timeout: 30000 })

  test("shows name publicly; members and gigs follow the owner toggles", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_public_band" })
    const created = await page.request.post("/api/my/bands", {
      data: { slug: "test-public-profile", name: "Public Profile Band" },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string; slug: string; name: string }

    const setlist = await page.request.post("/api/setlists", {
      data: {
        band_id: band.id,
        name: "Friday Gig",
        description: null,
        gig_date: "2026-11-07",
        status: "draft",
      },
    })
    expect(setlist.ok(), await setlist.text()).toBe(true)

    // Signed-out visitor sees the name, not members or dates (toggles default off).
    await page.context().clearCookies()
    await page.goto(`/b/${band.slug}`)
    await expect(getPw(page, "public-band-page")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, "public-band-name")).toHaveText(band.name)
    await expect(getPw(page, "public-band-members")).toHaveCount(0)
    await expect(getPw(page, "public-band-gigs")).toHaveCount(0)

    await testing.login({ username: "test_public_band" })
    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-public-settings")).toBeVisible({ timeout: 5000 })

    await getPw(page, "band-public-description").fill("We play loud.")
    await getPw(page, "band-public-show-members").check()
    await getPw(page, "band-public-show-gigs").check()
    await getPw(page, "band-public-settings-submit").click()
    await expect(getPw(page, "band-public-settings-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/b/${band.slug}`)
    await expect(getPw(page, "public-band-description")).toContainText("We play loud.")
    await expect(getPw(page, "public-band-members")).toBeVisible()
    await expect(getPw(page, "public-band-member-test_public_band")).toBeVisible()
    await expect(getPw(page, "public-band-gigs")).toBeVisible()
    await expect(getPw(page, "public-band-gig-2026-11-07")).toContainText("Friday Gig")

    await testing.login({ username: "test_public_band" })
    await page.goto(`/band/${band.id}`)
    await getPw(page, "band-public-show-members").uncheck()
    await getPw(page, "band-public-show-gigs").uncheck()
    await getPw(page, "band-public-settings-submit").click()
    await expect(getPw(page, "band-public-settings-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/b/${band.slug}`)
    await expect(getPw(page, "public-band-name")).toHaveText(band.name)
    await expect(getPw(page, "public-band-members")).toHaveCount(0)
    await expect(getPw(page, "public-band-gigs")).toHaveCount(0)
  })

  test("missing slug shows not found", async ({ page }) => {
    await page.goto("/b/no-such-band-slug-xyz")
    await expect(getPw(page, "public-band-missing")).toBeVisible({ timeout: 5000 })
  })
})
