import type { Browser, Page } from "@playwright/test"
import { test, expect, getPw, TEST_PASSWORD, testSlug } from "./helpers"

/** A band the owner creates. */
const newBand = async (owner: Page, name: string) => {
  const band = await owner.request.post("/api/my/bands", {
    data: { slug: testSlug("pending"), name },
  })
  expect(band.ok(), await band.text()).toBe(true)
  return (await band.json()).id as string
}

/** Register and verify an invitee, then have the owner invite them by username. */
const inviteUser = async (
  browser: Browser,
  owner: Page,
  bandId: string,
  username: string,
) => {
  const context = await browser.newContext()
  const invitee = await context.newPage()
  const login = await invitee.request.post("/api/testing/login", {
    data: { username, password: TEST_PASSWORD },
  })
  expect(login.ok(), await login.text()).toBe(true)
  const verified = await owner.request.get(
    `/api/testing/verify-user?username=${username}`,
  )
  expect(verified.ok(), await verified.text()).toBe(true)
  const sent = await owner.request.post(`/api/my/bands/${bandId}/invite`, {
    data: { username },
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  return { context, invitee }
}

test.describe("pending band invitations", () => {
  test.describe.configure({ timeout: 30000 })

  test("owner sees a pending invitation and cancel removes it for the invitee", async ({
    page,
    browser,
    testing,
  }) => {
    await testing.login()
    const bandId = await newBand(page, "Test: Pending invitations")
    const inviteeName = testing.username("test_pending_invitee")
    const { context, invitee } = await inviteUser(
      browser,
      page,
      bandId,
      inviteeName,
    )

    await invitee.goto("/")
    await expect(getPw(invitee, "invitation")).toContainText(
      "Join Test: Pending invitations",
      { timeout: 10000 },
    )

    await page.goto(`/band/${bandId}`)
    await expect(getPw(page, "band-pending-invitations")).toBeVisible({
      timeout: 5000,
    })
    await expect(getPw(page, "band-pending-invitations")).toContainText(
      `@${inviteeName}`,
    )

    const listed = await page.request.get(`/api/my/bands/${bandId}/invitations`)
    expect(listed.ok(), await listed.text()).toBe(true)
    const rows = (await listed.json()) as Array<{ id: string; username: string | null }>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.username).toBe(inviteeName)
    const invitationId = rows[0]?.id
    expect(invitationId).toBeTruthy()

    page.once("dialog", (dialog) => dialog.accept())
    await getPw(page, `band-pending-cancel-${invitationId}`).click()
    await expect(getPw(page, "band-pending-invitations")).toHaveCount(0, {
      timeout: 5000,
    })

    await invitee.reload()
    await expect(getPw(invitee, "invitations")).toHaveCount(0, { timeout: 10000 })
    await context.close()
  })

  test("a cancelled email invitation's accept link says it no longer exists", async ({
    page,
    browser,
    testing,
  }) => {
    await testing.login()
    const bandId = await newBand(page, "Test: Pending email cancel")
    const email = `${testing.username("test_pending_email")}@test.local`
    const sent = await page.request.post(`/api/my/bands/${bandId}/invite`, {
      data: { email },
    })
    expect(sent.ok(), await sent.text()).toBe(true)
    const secret = await page.request.get(
      `/api/testing/band-invitation?band_id=${bandId}&email=${encodeURIComponent(email)}`,
    )
    expect(secret.ok(), await secret.text()).toBe(true)
    const { id, code } = (await secret.json()) as { id: string; code: string }

    await page.goto(`/band/${bandId}`)
    await expect(getPw(page, "band-pending-invitations")).toContainText(email, {
      timeout: 5000,
    })
    page.once("dialog", (dialog) => dialog.accept())
    await getPw(page, `band-pending-cancel-${id}`).click()
    await expect(getPw(page, "band-pending-invitations")).toHaveCount(0, {
      timeout: 5000,
    })

    const context = await browser.newContext()
    const invitee = await context.newPage()
    const login = await invitee.request.post("/api/testing/login", {
      data: {
        username: testing.username("test_pending_email_invitee"),
        password: TEST_PASSWORD,
      },
    })
    expect(login.ok(), await login.text()).toBe(true)
    await invitee.goto(`/invitations/accept?id=${id}&code=${code}`)
    await getPw(invitee, "accept-invitation-submit").click()
    await expect(getPw(invitee, "accept-invitation-error")).toContainText(
      "no longer exists",
      { timeout: 10000 },
    )
    await context.close()
  })

  test("a non-owner sees no pending invitations list", async ({
    page,
    browser,
    testing,
  }) => {
    await testing.login({ username: "test_pending_owner" })
    const bandId = await newBand(page, "Test: Pending non-owner")
    const mateName = testing.username("test_pending_mate")
    await page.request.post("/api/testing/login", {
      data: { username: mateName, password: TEST_PASSWORD },
    })
    await testing.login({ username: "test_pending_owner" })
    const added = await page.request.post("/api/testing/band-member", {
      data: { band_id: bandId, username: mateName },
    })
    expect(added.ok(), await added.text()).toBe(true)

    const inviteeName = testing.username("test_pending_hidden")
    const invited = await inviteUser(browser, page, bandId, inviteeName)
    await invited.context.close()

    const context = await browser.newContext()
    const mate = await context.newPage()
    const login = await mate.request.post("/api/testing/login", {
      data: { username: mateName, password: TEST_PASSWORD },
    })
    expect(login.ok(), await login.text()).toBe(true)
    await mate.goto(`/band/${bandId}`)
    await expect(getPw(mate, "band-members")).toBeVisible({ timeout: 5000 })
    await expect(getPw(mate, "band-pending-invitations")).toHaveCount(0)
    expect(
      (await mate.request.get(`/api/my/bands/${bandId}/invitations`)).status(),
    ).toBe(400)
    await context.close()
  })
})
