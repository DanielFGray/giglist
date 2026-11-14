import type { Browser, Page } from "@playwright/test"
import { test, expect, getPw, TEST_PASSWORD, testSlug } from "./helpers"

/** A band the owner creates. */
const newBand = async (owner: Page, name: string) => {
  const band = await owner.request.post("/api/my/bands", { data: { slug: testSlug("invite"), name } })
  expect(band.ok(), await band.text()).toBe(true)
  return (await band.json()).id as string
}

/** The band owner (the fixture's page) invites a new, verified user, who gets a browser of their own. */
const invite = async (browser: Browser, owner: Page, username: string) => {
  const bandId = await newBand(owner, "Test: Invitations")

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
    const { bandId, context, invitee } = await invite(browser, page, testing.username("test_invitee"))

    // Before accepting, the band's songs are out of reach.
    expect((await songsOf(invitee, bandId)).status()).not.toBe(200)

    await invitee.goto("/")
    await expect(getPw(invitee, "invitation")).toContainText("Join Test: Invitations", { timeout: 10000 })
    await getPw(invitee, "invitation-accept").click()
    await expect(invitee).toHaveURL(new RegExp(`/band/${bandId}`), { timeout: 10000 })
    await expect(getPw(invitee, "band-members")).toBeVisible({ timeout: 10000 })
    expect((await songsOf(invitee, bandId)).status()).toBe(200)

    // The invitation is used up: it does not come back.
    await invitee.goto("/")
    await expect(getPw(invitee, "dashboard")).toBeVisible()
    await expect(getPw(invitee, "invitations")).toHaveCount(0)
    await context.close()
  })

  test("declining removes the invitation and adds no membership", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, context, invitee } = await invite(browser, page, testing.username("test_decliner"))

    await invitee.goto("/")
    await getPw(invitee, "invitation-decline").click()
    await expect(getPw(invitee, "invitations")).toHaveCount(0, { timeout: 10000 })
    await expect(getPw(invitee, "dashboard-no-band")).toBeVisible()
    expect((await songsOf(invitee, bandId)).status()).not.toBe(200)
    await context.close()
  })

  test("nobody but the invited user can accept or decline an invitation", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, context, invitee } = await invite(browser, page, testing.username("test_invitee"))
    const invitationId = ((await (await invitee.request.get("/api/my/bands/invitations")).json()) as Array<{ id: string }>)[0]!.id

    const strangerContext = await browser.newContext()
    const stranger = await strangerContext.newPage()
    await stranger.request.post("/api/testing/login", { data: { username: testing.username("test_stranger"), password: TEST_PASSWORD } })
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

/** The owner invites an address with no account. Returns the invitation's id and the code its emailed link carries. */
const inviteByEmail = async (owner: Page, bandId: string, email: string) => {
  const sent = await owner.request.post(`/api/my/bands/${bandId}/invite`, { data: { email } })
  expect(sent.ok(), await sent.text()).toBe(true)
  const secret = await owner.request.get(`/api/testing/band-invitation?band_id=${bandId}&email=${encodeURIComponent(email)}`)
  expect(secret.ok(), await secret.text()).toBe(true)
  const { id, code } = (await secret.json()) as { id: string; code: string }
  expect(code).toBeTruthy()
  return { id, code }
}

test.describe("emailed band invitations", () => {
  test("a signed-in invitee opens the emailed link and joins the band with its code", async ({ page, browser, testing }) => {
    await testing.login()
    const bandId = await newBand(page, "Test: Emailed invitations")
    const { id, code } = await inviteByEmail(page, bandId, `${testing.username("test_emailed")}@test.local`)

    const context = await browser.newContext()
    const invitee = await context.newPage()
    const login = await invitee.request.post("/api/testing/login", { data: { username: testing.username("test_emailed_invitee"), password: TEST_PASSWORD } })
    expect(login.ok(), await login.text()).toBe(true)
    expect((await songsOf(invitee, bandId)).status()).not.toBe(200)

    await invitee.goto(`/invitations/accept?id=${id}&code=${code}`)
    await getPw(invitee, "accept-invitation-submit").click()
    await expect(invitee).toHaveURL(new RegExp(`/band/${bandId}`), { timeout: 10000 })
    await expect(getPw(invitee, "band-members")).toBeVisible({ timeout: 10000 })
    expect((await songsOf(invitee, bandId)).status()).toBe(200)
    await context.close()
  })

  test("an invitation to the user's verified email shows on their home page, and joining answers every invitation to that band", async ({ page, browser, testing }) => {
    await testing.login()
    const bandId = await newBand(page, "Test: Verified email")

    const context = await browser.newContext()
    const invitee = await context.newPage()
    const username = testing.username("test_verified_email")
    const email = `${username}@test.local`
    const login = await invitee.request.post("/api/testing/login", { data: { username, password: TEST_PASSWORD } })
    expect(login.ok(), await login.text()).toBe(true)
    const secrets = await invitee.request.get(`/api/testing/email-secrets?email=${encodeURIComponent(email)}`)
    expect(secrets.ok(), await secrets.text()).toBe(true)
    const { user_email_id, verification_token } = (await secrets.json()) as { user_email_id: string; verification_token: string }
    const verified = await invitee.request.post("/api/auth/emails/verify", { data: { id: user_email_id, token: verification_token } })
    expect(verified.ok(), await verified.text()).toBe(true)

    await inviteByEmail(page, bandId, email)
    await invitee.goto("/")
    await expect(getPw(invitee, "invitation")).toHaveText([/Join Test: Verified email/], { timeout: 10000 })

    // A second invitation to the same band, by username, still shows one Join.
    const byName = await page.request.post(`/api/my/bands/${bandId}/invite`, { data: { username } })
    expect(byName.ok(), await byName.text()).toBe(true)
    await invitee.reload()
    await expect(getPw(invitee, "invitation")).toHaveText([/Join Test: Verified email/], { timeout: 10000 })

    await getPw(invitee, "invitation-accept").click()
    await expect(invitee).toHaveURL(new RegExp(`/band/${bandId}`), { timeout: 10000 })
    expect((await songsOf(invitee, bandId)).status()).toBe(200)
    // Both invitations are used up, so the owner has none left pending.
    expect(await (await page.request.get(`/api/my/bands/${bandId}/invitations`)).json()).toEqual([])
    await context.close()
  })

  test("a wrong code is refused and joins nobody", async ({ page, browser, testing }) => {
    await testing.login()
    const bandId = await newBand(page, "Test: Emailed invitations")
    const { id } = await inviteByEmail(page, bandId, `${testing.username("test_wrong_code")}@test.local`)

    const context = await browser.newContext()
    const invitee = await context.newPage()
    await invitee.request.post("/api/testing/login", { data: { username: testing.username("test_wrong_code_invitee"), password: TEST_PASSWORD } })

    await invitee.goto(`/invitations/accept?id=${id}&code=not-the-code`)
    await getPw(invitee, "accept-invitation-submit").click()
    await expect(getPw(invitee, "accept-invitation-error")).toContainText("does not match this invitation", { timeout: 10000 })
    expect((await songsOf(invitee, bandId)).status()).not.toBe(200)
    await context.close()
  })

  test("a signed-out visitor is asked to sign in and cannot accept", async ({ page, browser, testing }) => {
    await testing.login()
    const bandId = await newBand(page, "Test: Emailed invitations")
    const { id, code } = await inviteByEmail(page, bandId, `${testing.username("test_signed_out")}@test.local`)

    const context = await browser.newContext()
    const visitor = await context.newPage()
    await visitor.goto(`/invitations/accept?id=${id}&code=${code}`)
    await expect(getPw(visitor, "accept-invitation-signin")).toBeVisible({ timeout: 10000 })
    await expect(getPw(visitor, "accept-invitation-submit")).toHaveCount(0)
    await context.close()
  })
})
