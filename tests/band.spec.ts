import { test, expect, getPw } from "./helpers"

/**
 * A band name no other run uses. The create form derives the slug from the
 * name, so a fixed name makes two runs in the same checkout race on one slug.
 */
const bandName = (stem: string) =>
  `Test: ${stem} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

test.describe("bands", () => {
  test("shows create band prompt when user has no bands", async ({
    page,
    testing,
  }) => {
    await testing.login()
    await page.goto("/band")
    await expect(getPw(page, "band-empty")).toBeVisible()
    await expect(getPw(page, "band-create-cta")).toBeVisible()
  })

  test("can create a band via UI", async ({ page, testing }) => {
    await testing.login()
    // Warm up: hit a page first to ensure Vite modules are loaded
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await page.goto("/band/new")
    await page.waitForLoadState("networkidle")
    await getPw(page, "new-band-name").fill(bandName("My Band"))
    await getPw(page, "new-band-submit").click()

    await expect(getPw(page, "band-page")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "band-members")).toBeVisible({ timeout: 5000 })
  })

  test("band appears in switcher after creation", async ({
    page,
    testing,
  }) => {
    await testing.login()
    await page.goto("/band/new")
    const name = bandName("Switcher Band")
    await getPw(page, "new-band-name").fill(name)
    await getPw(page, "new-band-submit").click()
    await expect(getPw(page, "band-page")).toBeVisible({ timeout: 5000 })

    // Band switcher should show the band name
    await expect(getPw(page, "band-switcher")).toBeVisible()
    await expect(getPw(page, "band-switcher-toggle")).toContainText(name)
  })

  test("owner is listed as member", async ({ page, testing }) => {
    const me = await testing.login()
    await page.goto("/band/new")
    await getPw(page, "new-band-name").fill(bandName("Member Check"))
    await getPw(page, "new-band-submit").click()
    await expect(getPw(page, "band-page")).toBeVisible({ timeout: 5000 })

    // Members list should include the owner
    const members = getPw(page, "band-members")
    await expect(members).toContainText(me.username)
    await expect(members).toContainText("Owner")
  })

  test("shows error for duplicate band slug", async ({ page, testing }) => {
    await testing.login()

    // Create first band
    const name = bandName("Dupe Band")
    await page.goto("/band/new")
    await getPw(page, "new-band-name").fill(name)
    await getPw(page, "new-band-submit").click()
    await expect(getPw(page, "band-page")).toBeVisible({ timeout: 5000 })

    // Try to create another with same name
    await page.goto("/band/new")
    await getPw(page, "new-band-name").fill(name)
    await getPw(page, "new-band-submit").click()
    await expect(getPw(page, "new-band-error")).toBeVisible({ timeout: 5000 })
  })
})
