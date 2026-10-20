import type { Locator, Page } from "@playwright/test"
import { test, expect, getPw } from "./helpers"

/** `YYYY-MM-DD`, `days` from today. */
const dayFromToday = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const post = async (page: Page, url: string, data: object) => {
  const res = await page.request.post(url, { data })
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json()) as { id: string; slug: string; name: string }
}

const enablePublicPage = async (page: Page, bandId: string) => {
  const res = await page.request.put(`/api/my/bands/${bandId}`, { data: { is_public: true } })
  expect(res.ok(), await res.text()).toBe(true)
}

/** The body of the band page frame inside `within`, which a sandboxed theme fills. */
const themed = (within: Page | Locator) => within.locator('[data-pwid="public-band-page"]').contentFrame().locator("body")

const gig = (band_id: string, venue: string | null, gig_date: string) => ({
  band_id,
  venue,
  notes: "Private: load in through the kitchen",
  gig_date,
  address: null,
  load_in_time: null,
  performance_time: null,
})

test.describe("public band page", () => {
  test.describe.configure({ timeout: 30000 })

  test("a band has no public page until its owner turns one on, and none after turning it off", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_public_switch" })
    const band = await post(page, "/api/my/bands", { slug: "test-public-switch", name: "Switch Band" })
    await page.goto(`/b/${band.slug}`)
    await expect(getPw(page, "public-band-missing")).toBeVisible({ timeout: 5000 })

    await page.goto(`/band/${band.id}`)
    const enable = getPw(page, "band-public-enable")
    await expect(enable).toHaveAttribute("aria-checked", "false")
    await expect(getPw(page, "band-public-settings")).toHaveCount(0)
    await expect(getPw(page, "band-public-profile-link")).toHaveCount(0)

    await enable.click()
    await expect(enable).toHaveAttribute("aria-checked", "true")
    await expect(getPw(page, "band-public-settings")).toBeVisible()
    await getPw(page, "band-public-profile-link").click()
    await expect(themed(page).locator("h1")).toHaveText(band.name)

    await page.goto(`/band/${band.id}`)
    await getPw(page, "band-public-enable").click()
    await expect(getPw(page, "band-public-settings")).toHaveCount(0)
    await page.goto(`/b/${band.slug}`)
    await expect(getPw(page, "public-band-missing")).toBeVisible({ timeout: 5000 })
  })

  test("shows the name publicly; members, upcoming dates and songs follow the owner toggles", async ({
    page,
    testing,
  }) => {
    const me = await testing.login({ username: "test_public_band" })
    const band = await post(page, "/api/my/bands", { slug: "test-public-profile", name: "Public Profile Band" })
    await enablePublicPage(page, band.id)
    const upcoming = dayFromToday(30)
    await post(page, "/api/gigs", gig(band.id, "The Echo Room", upcoming))
    await post(page, "/api/gigs", gig(band.id, null, dayFromToday(31)))
    await post(page, "/api/gigs", gig(band.id, "Old Venue", dayFromToday(-30)))
    await post(page, "/api/songs", {
      band_id: band.id,
      title: "Waterloo Sunset",
      artist: "The Kinks",
      key: null,
      tempo_bpm: null,
      duration_seconds: null,
      capo: null,
      notes: null,
    })

    // Signed-out visitor sees the name, and nothing the list switches (default off) hide.
    await page.context().clearCookies()
    await page.goto(`/b/${band.slug}`)
    await expect(themed(page).locator("h1")).toHaveText(band.name, { timeout: 5000 })
    await expect(themed(page).locator("section")).toHaveCount(0)

    await testing.login({ username: "test_public_band" })
    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-public-settings")).toBeVisible({ timeout: 5000 })

    await getPw(page, "band-public-description").fill("We play loud.")
    await getPw(page, "band-public-show-members").check()
    await getPw(page, "band-public-show-gigs").check()
    await getPw(page, "band-public-show-songs").check()
    await getPw(page, "band-public-settings-submit").click()
    await expect(getPw(page, "band-public-settings-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/b/${band.slug}`)
    const body = themed(page)
    await expect(body.locator(".description")).toHaveText("We play loud.", { timeout: 5000 })
    await expect(body.locator(".members")).toContainText(`@${me.username}`)
    await expect(body.locator(`.gigs time[datetime="${upcoming}"]`)).toBeVisible()
    await expect(body.locator(".gigs")).toContainText("The Echo Room")
    await expect(body.locator(".gigs li")).toHaveCount(2)
    await expect(body.locator(".gigs")).not.toContainText("Old Venue")
    await expect(body).not.toContainText("kitchen")
    await expect(body.locator(".songs")).toContainText("Waterloo Sunset · The Kinks")

    await testing.login({ username: "test_public_band" })
    await page.goto(`/band/${band.id}`)
    await getPw(page, "band-public-show-members").uncheck()
    await getPw(page, "band-public-show-gigs").uncheck()
    await getPw(page, "band-public-show-songs").uncheck()
    await getPw(page, "band-public-settings-submit").click()
    await expect(getPw(page, "band-public-settings-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/b/${band.slug}`)
    await expect(themed(page).locator("h1")).toHaveText(band.name, { timeout: 5000 })
    await expect(themed(page).locator("section")).toHaveCount(0)
  })

  test("the description is Markdown: links open in a new tab and a lone provider link plays in the page", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_public_markdown" })
    const band = await post(page, "/api/my/bands", { slug: "test-public-markdown", name: "Markdown Band" })
    await enablePublicPage(page, band.id)
    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-public-settings")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, "band-public-description-help")).toContainText("Spotify")

    await getPw(page, "band-public-description").fill(
      [
        "**Loud** & proud. Tour dates on [our site](https://example.com/tour).",
        "",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "",
        '<script>document.body.dataset.ran = "yes"</script>',
      ].join("\n"),
    )

    // The preview renders it the same way, players included.
    const preview = themed(getPw(page, "band-public-preview"))
    await expect(preview.locator(".description strong")).toHaveText("Loud")
    await expect(preview.locator('iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toHaveCount(1)

    await getPw(page, "band-public-settings-submit").click()
    await expect(getPw(page, "band-public-settings-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/b/${band.slug}`)
    const body = themed(page)
    const description = body.locator(".description")
    await expect(description.locator("strong")).toHaveText("Loud", { timeout: 5000 })
    await expect(description).toContainText("& proud")
    const link = description.locator('a[href="https://example.com/tour"]')
    await expect(link).toHaveAttribute("target", "_blank")
    await expect(link).toHaveAttribute("rel", /noopener/)
    await expect(description.locator('iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toHaveCount(1)
    // The typed script shows as text and does not run, even in a script-allowing frame.
    await expect(description).toContainText("<script>")
    await expect(body).not.toHaveAttribute("data-ran", "yes")
  })

  test("the owner starts from a theme, sets its options, and the public page wears them", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_public_theme" })
    const band = await post(page, "/api/my/bands", { slug: "test-public-theme", name: "Theme Band" })
    await enablePublicPage(page, band.id)
    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-public-settings")).toBeVisible({ timeout: 5000 })

    const preview = themed(getPw(page, "band-public-preview"))
    await expect(preview.locator("h1")).toHaveText("Theme Band")

    await getPw(page, "band-public-starter-poster").click()
    await expect(preview.locator(".poster")).toBeVisible()

    // The poster declares these options; each gets a field and shows in the preview.
    await getPw(page, "band-public-option-color-Ink").fill("#112233")
    await getPw(page, "band-public-option-text-Kicker").fill("Tonight")
    await getPw(page, "band-public-option-image-Photo").fill("https://images.example/band.jpg")
    await expect(preview.locator(".kicker")).toHaveText("Tonight")
    await expect(preview.locator("img.photo")).toHaveAttribute("src", "https://images.example/band.jpg")

    await getPw(page, "band-public-settings-submit").click()
    await expect(getPw(page, "band-public-settings-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/b/${band.slug}`)
    const body = themed(page)
    await expect(body.locator(".poster")).toBeVisible({ timeout: 5000 })
    await expect(body).toHaveCSS("color", "rgb(17, 34, 51)")
    await expect(body.locator(".kicker")).toHaveText("Tonight")
  })

  test("a band writes its own theme; its options appear and its scripts do not run", async ({ page, testing }) => {
    await testing.login({ username: "test_public_own_theme" })
    const band = await post(page, "/api/my/bands", { slug: "test-public-own-theme", name: "Own Theme Band" })
    await enablePublicPage(page, band.id)
    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-public-settings")).toBeVisible({ timeout: 5000 })

    await page.getByText("Edit theme HTML").click()
    await getPw(page, "band-public-theme-source").fill(
      [
        '<meta name="color:Glow" content="#00ff00">',
        "<style>h1 { color: {color:Glow} }</style>",
        "<h1>{BandName}</h1>",
        "<script>document.body.dataset.ran = 'yes'</script>",
      ].join("\n"),
    )
    await expect(getPw(page, "band-public-option-color-Glow")).toHaveValue("#00ff00")
    await getPw(page, "band-public-option-color-Glow").fill("#ff00ff")
    await getPw(page, "band-public-settings-submit").click()
    await expect(getPw(page, "band-public-settings-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/b/${band.slug}`)
    const body = themed(page)
    await expect(body.locator("h1")).toHaveCSS("color", "rgb(255, 0, 255)", { timeout: 5000 })
    await expect(body).not.toHaveAttribute("data-ran", "yes")
  })

  test("missing slug answers 404 and shows not found", async ({ page }) => {
    // The page shows "not found" only for a 404; any other failure goes to the error boundary.
    expect((await page.request.get("/api/public/bands/no-such-band-slug-xyz")).status()).toBe(404)
    await page.goto("/b/no-such-band-slug-xyz")
    await expect(getPw(page, "public-band-missing")).toBeVisible({ timeout: 5000 })
  })
})
