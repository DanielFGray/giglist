import { Schema as S } from "effect"
import { test, expect, getPw, TEST_PASSWORD } from "./helpers"
// Only the fields the spec reads: the endpoints' full schemas carry `S.Date`, which does not decode the JSON strings the wire holds.
const ResetToken = S.Struct({ reset_password_token: S.NullOr(S.String) })
const UserId = S.Struct({ user_id: S.String })

test.describe("password reset", () => {
  test("resets a password and signs the user in", async ({ page, testing }) => {
    const username = testing.username("reset")
    const email = `${username}@test.local`
    const oldPassword = "old_password_123!"
    await page.goto("/signup")
    await getPw(page, "signup-username").fill(username)
    await getPw(page, "signup-email").fill(email)
    await getPw(page, "signup-password").fill(oldPassword)
    await getPw(page, "signup-submit").click()
    await expect(getPw(page, "dashboard")).toBeVisible()

    await page.goto("/forgot")
    await getPw(page, "forgot-email").fill(email)
    await getPw(page, "forgot-submit").click()
    await expect(getPw(page, "forgot-sent")).toHaveText(
      "If that address has an account, we sent a link.",
    )

    const emailSecretsResponse = await page.request.get("/api/testing/email-secrets", {
      params: { email },
    })
    expect(emailSecretsResponse.ok(), await emailSecretsResponse.text()).toBe(true)
    const emailSecrets = S.decodeUnknownSync(ResetToken)(await emailSecretsResponse.json())
    expect(emailSecrets.reset_password_token).not.toBeNull()

    const userSecretsResponse = await page.request.get("/api/testing/user-secrets", {
      params: { username },
    })
    expect(userSecretsResponse.ok(), await userSecretsResponse.text()).toBe(true)
    const userSecrets = S.decodeUnknownSync(UserId)(await userSecretsResponse.json())
    const token = emailSecrets.reset_password_token
    expect(token).not.toBeNull()
    await page.goto(`/reset?userId=${userSecrets.user_id}&token=${encodeURIComponent(token ?? "")}`)
    await getPw(page, "reset-password").fill("new_password_456!")
    await getPw(page, "reset-submit").click()
    await expect(getPw(page, "dashboard")).toBeVisible()

    await page.context().clearCookies()
    await page.goto("/login")
    await getPw(page, "login-id").fill(username)
    await getPw(page, "login-password").fill(oldPassword)
    await getPw(page, "login-submit").click()
    await expect(getPw(page, "login-error")).toBeVisible()

    await getPw(page, "login-password").fill("new_password_456!")
    await getPw(page, "login-submit").click()
    await expect(getPw(page, "dashboard")).toBeVisible()
  })

  test("keeps the form open and shows one error for a wrong token", async ({ page, testing }) => {
    const user = await testing.login({ username: "reset_wrong_token", password: TEST_PASSWORD })
    await page.goto("/forgot")
    await getPw(page, "forgot-email").fill(user.email)
    await getPw(page, "forgot-submit").click()
    await expect(getPw(page, "forgot-sent")).toBeVisible()

    const userSecretsResponse = await page.request.get("/api/testing/user-secrets", {
      params: { username: user.username },
    })
    expect(userSecretsResponse.ok(), await userSecretsResponse.text()).toBe(true)
    const userSecrets = S.decodeUnknownSync(UserId)(await userSecretsResponse.json())

    await page.goto(`/reset?userId=${userSecrets.user_id}&token=wrong-token`)
    await getPw(page, "reset-password").fill("new_password_456!")
    await getPw(page, "reset-submit").click()
    await expect(getPw(page, "reset-error")).toHaveText("This reset link is invalid or expired")
    await expect(getPw(page, "reset-password")).toBeVisible()
  })
})
