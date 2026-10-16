import { test, expect, getPw, loginViaUi, TEST_PASSWORD } from "./helpers"
import { BASE_URL } from "./baseUrl"

test.describe("auth", () => {
  test("shows sign in link when not logged in", async ({ page }) => {
    await page.goto("/")
    await expect(getPw(page, "nav-signin")).toBeVisible()
    await expect(getPw(page, "nav-links")).not.toBeVisible()
  })

  test("offers sign in, not band creation, on the landing page", async ({ page }) => {
    await page.goto("/")
    await expect(getPw(page, "dashboard-signin")).toBeVisible()
    await expect(getPw(page, "dashboard-signup")).toBeVisible()
    // Band creation needs a session; offering it here led to a 4xx on submit.
    await expect(getPw(page, "dashboard-create-band")).toHaveCount(0)
  })

  test("sends a signed-out visitor from a band page to sign in", async ({ page }) => {
    await page.goto("/band/new")
    await expect(getPw(page, "login-page")).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test("logs in by opening a GET testing URL", async ({ page }) => {
    // The dev shortcut: no console, no signup form. A fixed name so repeated
    // runs reuse one account instead of littering the database.
    await page.goto(
      `/api/testing/login?username=dev_gologin&password=${encodeURIComponent(TEST_PASSWORD)}`,
    )
    await expect(getPw(page, "nav-links")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "nav-signin")).toHaveCount(0)
    await expect(page).not.toHaveURL(/\/api\/testing\//)
  })

  test("can navigate between login and signup", async ({ page }) => {
    await page.goto("/login")
    await expect(getPw(page, "login-page")).toBeVisible()
    await getPw(page, "login-to-signup").click()
    await expect(getPw(page, "signup-page")).toBeVisible()
    await getPw(page, "signup-to-login").click()
    await expect(getPw(page, "login-page")).toBeVisible()
  })

  test("can register via UI", async ({ page }) => {
    await page.goto("/signup")
    await getPw(page, "signup-username").fill("test_newuser")
    await getPw(page, "signup-email").fill("test_newuser@test.local")
    await getPw(page, "signup-password").fill("testpassword123")
    await getPw(page, "signup-submit").click()

    await expect(getPw(page, "dashboard")).toBeVisible({ timeout: 10000 })
    await expect(getPw(page, "nav-links")).toBeVisible()
  })

  test("can login via UI", async ({ page, testing }) => {
    // Create user via testing API (don't need the session — will login via UI)
    await testing.login({ username: "test_loginui" })
    await page.context().clearCookies()

    await loginViaUi(page, "test_loginui", TEST_PASSWORD)
  })

  test("can log out", async ({ page, testing }) => {
    await testing.login()
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await expect(getPw(page, "nav-links")).toBeVisible({ timeout: 5000 })
    await getPw(page, "nav-user-avatar").click()
    await expect(getPw(page, "nav-signin")).toBeVisible({ timeout: 5000 })
  })

  test("shows error for wrong password", async ({ page }) => {
    // Create user without keeping the session cookie in the browser
    await fetch(`${BASE_URL}/api/testing/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test_wrongpw" }),
    })

    await page.goto("/login")
    await getPw(page, "login-id").fill("test_wrongpw")
    await getPw(page, "login-password").fill("wrongpassword")
    await getPw(page, "login-submit").click()

    await expect(getPw(page, "login-error")).toBeVisible({ timeout: 5000 })
  })

  test("shows error for duplicate registration", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_dupe" })
    await page.context().clearCookies()

    await page.goto("/signup")
    await getPw(page, "signup-username").fill("test_dupe")
    await getPw(page, "signup-email").fill("test_dupe_new@test.local")
    await getPw(page, "signup-password").fill("testpassword123")
    await getPw(page, "signup-submit").click()

    await expect(getPw(page, "signup-error")).toBeVisible({ timeout: 5000 })
  })
})
