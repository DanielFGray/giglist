import { test, expect, getPw, loginViaUi, TEST_PASSWORD } from "./helpers"

test.describe("account settings", () => {
  test.describe.configure({ timeout: 30000 })

  test("opens settings from the user menu and updates the display name", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_settings_name" })
    await page.goto("/")
    await expect(getPw(page, "nav-links")).toBeVisible({ timeout: 5000 })

    await getPw(page, "nav-user-avatar").click()
    await getPw(page, "nav-settings").click()
    await expect(getPw(page, "settings-page")).toBeVisible()

    await getPw(page, "settings-name").fill("Stage Name")
    await getPw(page, "settings-profile-submit").click()
    await expect(getPw(page, "settings-profile-saved")).toBeVisible()

    await page.reload()
    await expect(getPw(page, "settings-name")).toHaveValue("Stage Name")
  })

  test("changes password and signs in with the new one", async ({
    page,
    testing,
  }) => {
    const username = "test_settings_pw"
    const nextPassword = "new_password_456!"
    await testing.login({ username })
    await page.goto("/settings")
    await expect(getPw(page, "settings-page")).toBeVisible({ timeout: 5000 })

    await getPw(page, "settings-old-password").fill(TEST_PASSWORD)
    await getPw(page, "settings-new-password").fill(nextPassword)
    await getPw(page, "settings-confirm-password").fill(nextPassword)
    await getPw(page, "settings-password-submit").click()
    await expect(getPw(page, "settings-password-saved")).toBeVisible()

    await getPw(page, "nav-user-avatar").click()
    await getPw(page, "nav-signout").click()
    await expect(getPw(page, "nav-signin")).toBeVisible({ timeout: 5000 })

    await loginViaUi(page, username, nextPassword)
  })

  test("adds a second email, verifies it, and makes it primary", async ({
    page,
    testing,
  }) => {
    const username = "test_settings_email"
    const firstEmail = `${username}@test.local`
    await testing.login({ username })

    // Seed a primary by verifying the signup address first; otherwise
    // verifying the second address would auto-promote it and hide Make primary.
    const firstSecrets = await page.request.get(
      `/api/testing/email-secrets?email=${encodeURIComponent(firstEmail)}`,
    )
    expect(firstSecrets.ok(), await firstSecrets.text()).toBe(true)
    const first = (await firstSecrets.json()) as {
      user_email_id: string
      verification_token: string | null
    }
    const verifiedFirst = await page.request.post("/api/auth/emails/verify", {
      data: { id: first.user_email_id, token: first.verification_token },
    })
    expect(verifiedFirst.ok(), await verifiedFirst.text()).toBe(true)

    await page.goto("/settings")
    await expect(getPw(page, "settings-page")).toBeVisible({ timeout: 5000 })

    const secondEmail = "test_settings_email_2@test.local"
    await getPw(page, "settings-add-email").fill(secondEmail)
    await getPw(page, "settings-add-email-submit").click()
    await expect(getPw(page, "settings-email-list")).toContainText(secondEmail)

    const secrets = await page.request.get(
      `/api/testing/email-secrets?email=${encodeURIComponent(secondEmail)}`,
    )
    expect(secrets.ok(), await secrets.text()).toBe(true)
    const body = (await secrets.json()) as {
      user_email_id: string
      verification_token: string | null
    }
    expect(body.verification_token).toBeTruthy()

    await page.goto(
      `/verify-email?id=${body.user_email_id}&token=${body.verification_token}`,
    )
    await expect(getPw(page, "verify-email-ok")).toBeVisible({ timeout: 5000 })

    await page.goto("/settings")
    await expect(getPw(page, "settings-page")).toBeVisible()
    await getPw(page, `settings-email-primary-${body.user_email_id}`).click()
    await expect(
      getPw(page, `settings-email-${body.user_email_id}`).getByText("Primary"),
    ).toBeVisible({ timeout: 5000 })
  })
})
