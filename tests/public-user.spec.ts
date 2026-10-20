import type { Locator, Page } from "@playwright/test"
import { test, expect, getPw } from "./helpers"

const post = async (page: Page, url: string, data: object) => {
  const res = await page.request.post(url, { data })
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json()) as { id: string; slug: string; name: string }
}

/** The body of the profile frame inside `within`, which a themed profile fills. */
const themed = (within: Page | Locator) => within.locator('[data-pwid="public-user-page"]').contentFrame().locator("body")

test.describe("public user profile", () => {
  test.describe.configure({ timeout: 30000 })

  test("a user has no profile until they turn one on, and none after turning it off", async ({
    page,
    testing,
  }) => {
    const me = await testing.login({ username: "test_public_user_switch" })
    await page.goto(`/u/${me.username}`)
    await expect(getPw(page, "public-user-missing")).toBeVisible({ timeout: 5000 })

    await page.goto("/settings")
    const enable = getPw(page, "settings-profile-public")
    await expect(enable).toHaveAttribute("aria-checked", "false")
    await enable.click()
    await getPw(page, "settings-profile-submit").click()
    await expect(getPw(page, "settings-profile-saved")).toBeVisible()
    await expect(getPw(page, "settings-profile-public-link")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/u/${me.username}`)
    await expect(themed(page)).toContainText(`@${me.username}`, { timeout: 5000 })

    await testing.login({ username: "test_public_user_switch" })
    await page.goto("/settings")
    await getPw(page, "settings-profile-public").click()
    await getPw(page, "settings-profile-submit").click()
    await expect(getPw(page, "settings-profile-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/u/${me.username}`)
    await expect(getPw(page, "public-user-missing")).toBeVisible({ timeout: 5000 })
  })

  test("the bio is Markdown with players, and lists only public bands", async ({ page, testing }) => {
    const me = await testing.login({ username: "test_public_user_bio" })
    const band = await post(page, "/api/my/bands", { slug: "test-public-user-band", name: "Profile Band" })
    await post(page, "/api/my/bands", { slug: "test-public-user-private", name: "Private Band" })
    const enabled = await page.request.put(`/api/my/bands/${band.id}`, { data: { is_public: true } })
    expect(enabled.ok(), await enabled.text()).toBe(true)

    await page.goto("/settings")
    await expect(getPw(page, "settings-page")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, "settings-bio-help")).toContainText("Spotify")

    await getPw(page, "settings-name").fill("Bio User")
    await getPw(page, "settings-bio").fill(
      [
        "**Drums** in the band. Clips on [our channel](https://example.com/clips).",
        "",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "",
        '<script>document.body.dataset.ran = "yes"</script>',
      ].join("\n"),
    )

    // The settings preview renders the bio as the profile will.
    const preview = getPw(page, "settings-bio-preview")
    await expect(preview.locator("strong")).toHaveText("Drums")
    await expect(preview.locator('iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toHaveCount(1)

    await getPw(page, "settings-profile-public").click()
    await getPw(page, "settings-profile-submit").click()
    await expect(getPw(page, "settings-profile-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/u/${me.username}`)
    const body = themed(page)
    await expect(body.locator("h1")).toHaveText("Bio User", { timeout: 5000 })
    const bio = body.locator(".bio")
    await expect(bio.locator("strong")).toHaveText("Drums")
    const link = bio.locator('a[href="https://example.com/clips"]')
    await expect(link).toHaveAttribute("target", "_blank")
    await expect(bio.locator('iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toHaveCount(1)
    await expect(bio).toContainText("<script>")
    await expect(body).not.toHaveAttribute("data-ran", "yes")

    await expect(body.locator(`a[href="/b/${band.slug}"]`)).toHaveText("Profile Band")
    await expect(body).not.toContainText("Private Band")
  })

  test("a user writes their own theme; its options appear and its scripts do not run", async ({ page, testing }) => {
    const me = await testing.login({ username: "test_public_user_theme" })
    await page.goto("/settings")
    await expect(getPw(page, "settings-page")).toBeVisible({ timeout: 5000 })

    // No ready-made themes are offered; the user edits the theme itself.
    await expect(page.getByText("Start from")).toHaveCount(0)

    const preview = themed(getPw(page, "settings-theme-preview"))
    await expect(preview.locator("h1")).toHaveText(me.username)

    await page.getByText("Edit theme HTML").click()
    await getPw(page, "settings-theme-source").fill(
      [
        '<meta name="color:Glow" content="#00ff00">',
        "<style>h1 { color: {color:Glow} }</style>",
        "<h1>{DisplayName}</h1>",
        "<div>{BioHTML}</div>",
        "<script>document.body.dataset.ran = 'yes'</script>",
      ].join("\n"),
    )
    await expect(getPw(page, "settings-theme-option-color-Glow")).toHaveValue("#00ff00")
    await getPw(page, "settings-theme-option-color-Glow").fill("#ff00ff")
    await expect(preview.locator("h1")).toHaveCSS("color", "rgb(255, 0, 255)")

    await getPw(page, "settings-profile-public").click()
    await getPw(page, "settings-profile-submit").click()
    await expect(getPw(page, "settings-profile-saved")).toBeVisible()

    await page.context().clearCookies()
    await page.goto(`/u/${me.username}`)
    const body = themed(page)
    await expect(body.locator("h1")).toHaveCSS("color", "rgb(255, 0, 255)", { timeout: 5000 })
    await expect(body).not.toHaveAttribute("data-ran", "yes")

    // Restoring brings the default theme back in the editor.
    await testing.login({ username: "test_public_user_theme" })
    await page.goto("/settings")
    await page.getByText("Edit theme HTML").click()
    await getPw(page, "settings-theme-reset").click()
    await expect(getPw(page, "settings-theme-source")).toContainText("{DisplayName}")
    await expect(themed(getPw(page, "settings-theme-preview")).locator(".username")).toHaveText(`@${me.username}`)
  })

  test("missing username answers 404 and shows not found", async ({ page }) => {
    expect((await page.request.get("/api/public/users/no-such-user-xyz")).status()).toBe(404)
    await page.goto("/u/no-such-user-xyz")
    await expect(getPw(page, "public-user-missing")).toBeVisible({ timeout: 5000 })
  })
})
