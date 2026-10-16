import type { Browser, Page } from "@playwright/test"
import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

/** The band owner (the fixture's page) invites a new, verified user, who gets a browser of their own. */
const invite = async (browser: Browser, owner: Page, username: string) => {
  const band = await owner.request.post("/api/my/bands", { data: { slug: `test-invite-${Date.now()}`, name: "Test: Invitations" } })
  expect(band.ok(), await band.text()).toBe(true)
  const bandId = (await band.json()).id as string

  const context = await browser.newContext()
  const invitee = await context.newPage()
  const login = await invitee.request.post("/api/testing/login", { data: { username, password: TEST_PASSWORD } })
  expect(login.ok(), await login.text()).toBe(true)
  // Inviting someone requires a verified account, and registering does not verify one.
  const verified = await owner.request.get(`/api/testing/verify-user?username=${username}`)
  expect(verified.ok(), await verified.text()).toBe(true)
  const sent = await owner.request.post(`/api/my/bands/${bandId}/invite`, { data: { username } })
  expect(sent.ok(), await sent.text()).toBe(true)
  return { bandId, context, invitee }
}

const songsOf = (page: Page, bandId: string) => page.request.get(`/api/songs/band/${bandId}`)

test.describe("band invitations", () => {
  test("an invited user sees the invitation and joins the band by accepting it", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, context, invitee } = await invite(browser, page, "test_invitee")

    // Before accepting, the band's songs are out of reach.
    expect((await songsOf(invitee, bandId)).status()).not.toBe(200)

    await invitee.goto("/")
    await expect(getPw(invitee, "invitation")).toContainText("Join Test: Invitations", { timeout: 10000 })
    await getPw(invitee, "invitation-accept").click()
    await expect(getPw(invitee, "invitations")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(invitee, "dashboard-setlists")).toBeVisible()
    expect((await songsOf(invitee, bandId)).status()).toBe(200)

    // The invitation is used up: it does not come back.
    await invitee.reload()
    await expect(getPw(invitee, "dashboard")).toBeVisible()
    await expect(getPw(invitee, "invitations")).toHaveCount(0)
    await context.close()
  })

  test("declining removes the invitation and adds no membership", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, context, invitee } = await invite(browser, page, "test_decliner")

    await invitee.goto("/")
    await getPw(invitee, "invitation-decline").click()
    await expect(getPw(invitee, "invitations")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(invitee, "dashboard-no-band")).toBeVisible()
    expect((await songsOf(invitee, bandId)).status()).not.toBe(200)
    await context.close()
  })

  test("nobody but the invited user can accept or decline an invitation", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, context, invitee } = await invite(browser, page, "test_invitee")
    const invitationId = ((await (await invitee.request.get("/api/my/bands/invitations")).json()) as Array<{ id: string }>)[0]!.id

    const strangerContext = await browser.newContext()
    const stranger = await strangerContext.newPage()
    await stranger.request.post("/api/testing/login", { data: { username: "test_stranger", password: TEST_PASSWORD } })
    expect(await (await stranger.request.get("/api/my/bands/invitations")).json()).toEqual([])
    expect((await stranger.request.post(`/api/my/bands/invitations/${invitationId}/accept`)).status()).toBe(400)
    // Declining someone else's invitation does nothing.
    await stranger.request.post(`/api/my/bands/invitations/${invitationId}/decline`)
    expect(await (await invitee.request.get("/api/my/bands/invitations")).json()).toHaveLength(1)
    expect((await songsOf(stranger, bandId)).status()).not.toBe(200)
    await strangerContext.close()
    await context.close()
  })
})
