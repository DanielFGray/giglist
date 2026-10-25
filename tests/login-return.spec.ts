import type { Page } from "@playwright/test"
import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

/** A band the owner creates. The random suffix keeps slugs unique across workers. */
const newBand = async (owner: Page, name: string) => {
  const suffix = Math.random().toString(36).slice(2, 8)
  const band = await owner.request.post("/api/my/bands", {
    data: { slug: `test-login-return-${Date.now()}-${suffix}`, name },
  })
  expect(band.ok(), await band.text()).toBe(true)
  return (await band.json()).id as string
}

/** The owner invites an address with no account; returns the emailed link's id and code. */
const inviteByEmail = async (owner: Page, bandId: string, email: string) => {
  const sent = await owner.request.post(`/api/my/bands/${bandId}/invite`, { data: { email } })
  expect(sent.ok(), await sent.text()).toBe(true)
  const secret = await owner.request.get(
    `/api/testing/band-invitation?band_id=${bandId}&email=${encodeURIComponent(email)}`,
  )
  expect(secret.ok(), await secret.text()).toBe(true)
  const { id, code } = (await secret.json()) as { id: string; code: string }
  expect(code).toBeTruthy()
  return { id, code }
}

test.describe("login return", () => {
  test("signing in from an invitation link returns to that link", async ({ page, browser, testing }) => {
    await testing.login()
    const bandId = await newBand(page, "Test: Login return")
    const inviteeName = testing.username("test_login_return_invitee")
    const { id, code } = await inviteByEmail(page, bandId, `${testing.username("test_login_return")}@test.local`)

    // Register the invitee so the UI login form has an account, then clear the
    // session so the accept page shows Sign in.
    const context = await browser.newContext()
    const invitee = await context.newPage()
    const registered = await invitee.request.post("/api/testing/login", {
      data: { username: inviteeName, password: TEST_PASSWORD },
    })
    expect(registered.ok(), await registered.text()).toBe(true)
    await invitee.context().clearCookies()

    await invitee.goto(`/invitations/accept?id=${id}&code=${code}`)
    await getPw(invitee, "accept-invitation-signin").click()
    await expect(getPw(invitee, "login-page")).toBeVisible()
    await getPw(invitee, "login-id").fill(inviteeName)
    await getPw(invitee, "login-password").fill(TEST_PASSWORD)
    await getPw(invitee, "login-submit").click()

    await expect(invitee).toHaveURL(new RegExp(`/invitations/accept\\?.*id=${id}`))
    await expect(getPw(invitee, "accept-invitation-submit")).toBeVisible({ timeout: 10000 })
    await context.close()
  })
})
