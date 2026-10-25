import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

test.describe("invite permissions", () => {
  test.describe.configure({ timeout: 30000 })

  test("owner sees the invite form on the band page", async ({ page, testing }) => {
    await testing.login({ username: "test_invite_owner" })
    const created = await page.request.post("/api/my/bands", {
      data: { slug: `test-invite-owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: "Invite Owner Band" },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-page")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, "band-members")).toBeVisible()
    await expect(getPw(page, "band-invite-form")).toBeVisible()
  })

  test("non-owner member does not see the invite form", async ({ page, testing }) => {
    await testing.login({ username: "test_invite_host" })
    const created = await page.request.post("/api/my/bands", {
      data: { slug: `test-invite-host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: "Invite Host Band" },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    const guestName = testing.username("test_invite_guest")
    await page.request.post("/api/testing/login", {
      data: { username: guestName, password: TEST_PASSWORD },
    })
    const added = await page.request.post("/api/testing/band-member", {
      data: { band_id: band.id, username: guestName },
    })
    expect(added.ok(), await added.text()).toBe(true)

    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-page")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, "band-members")).toBeVisible()
    await expect(getPw(page, "band-invite-form")).toHaveCount(0)
  })
})
