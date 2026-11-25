import { test, expect, getPw } from "./helpers"

const MESSAGE = "Playwright: the setlist grid lost a song once"

test.describe("feedback", () => {
  test("a signed-out visitor sends feedback from the nav", async ({ page }) => {
    await page.goto("/?token=synthetic-token#verify")

    await expect(getPw(page, "nav-feedback")).toBeVisible()
    await getPw(page, "nav-feedback").click()
    await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible()
    await expect(getPw(page, "feedback-category")).toBeVisible()

    await getPw(page, "feedback-message").fill(MESSAGE)

    const request = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().includes("/api/feedback"),
    )
    const response = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/feedback"),
    )
    await getPw(page, "feedback-submit").click()
    const body = JSON.parse((await request).postData() ?? "{}") as { readonly page_url?: string }
    const pageUrl = new URL(body.page_url ?? "https://invalid.example")
    expect(pageUrl.search).toBe("")
    expect(pageUrl.hash).toBe("")
    expect((await response).status()).toBe(200)
    await expect(getPw(page, "feedback-success")).toBeVisible()
  })

  test("a submission that fills the honeypot is refused", async ({ page }) => {
    await page.goto("/")
    await getPw(page, "nav-feedback").click()

    await getPw(page, "feedback-message").fill(MESSAGE)
    // The honeypot is off the page where only a bot reaches it; a script fills
    // it the way a bot does.
    await page.locator('[name="website"]').fill("http://spam.example")

    const response = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/feedback"),
    )
    await getPw(page, "feedback-submit").click()
    expect((await response).status()).toBe(400)
    await expect(getPw(page, "feedback-error")).toBeVisible()
  })

  test("a signed-in user sends feedback from the phone menu", async ({ page, testing }) => {
    await testing.login({ username: "test_feedback" })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")

    await getPw(page, "nav-hamburger").click()
    await getPw(page, "nav-mobile-feedback").click()
    await expect(getPw(page, "feedback-message")).toBeVisible()

    await getPw(page, "feedback-message").fill(MESSAGE)

    const response = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/feedback"),
    )
    await getPw(page, "feedback-submit").click()
    expect((await response).status()).toBe(200)
    await expect(getPw(page, "feedback-success")).toBeVisible()
  })

  test("a dismissed submission cannot change a later dialog", async ({ page }) => {
    await page.goto("/")

    let releaseResponse: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    await page.route("**/api/feedback", async (route) => {
      await held
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })

    await getPw(page, "nav-feedback").click()
    await getPw(page, "feedback-message").fill("The first request is still pending")
    const response = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/feedback"),
    )
    await getPw(page, "feedback-submit").click()
    await expect(getPw(page, "feedback-submit")).toHaveText("Sending...")
    await page.mouse.click(2, 2)
    await expect(page.getByRole("dialog")).toBeHidden()

    await getPw(page, "nav-feedback").click()
    await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible()
    releaseResponse()
    expect((await response).status()).toBe(200)

    await expect(getPw(page, "feedback-message")).toHaveValue("")
    await expect(getPw(page, "feedback-success")).toBeHidden()
  })
})
