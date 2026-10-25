import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

test.describe("invite errors", () => {
  test.describe.configure({ timeout: 30000 })

  test("inviting an unverified account shows why the invite failed", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_invite_err_owner" })
    const created = await page.request.post("/api/my/bands", {
      data: {
        slug: `test-invite-err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Invite Error Band",
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    // Register the invitee without verifying; invite_to_band refuses VRFY2.
    const invitee = testing.username("test_invite_err_guest")
    const registered = await page.request.post("/api/testing/login", {
      data: { username: invitee, password: TEST_PASSWORD },
    })
    expect(registered.ok(), await registered.text()).toBe(true)
    await testing.login({ username: "test_invite_err_owner" })

    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-invite-form")).toBeVisible({ timeout: 5000 })
    await getPw(page, "band-invite-input").fill(invitee)
    await getPw(page, "band-invite-submit").click()
    await expect(getPw(page, "band-invite-error")).toHaveText(
      "That account has not verified its email yet, so it cannot be invited",
      { timeout: 10000 },
    )
  })

  test("inviting the same person twice is refused with a reason", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_invite_dup_owner" })
    const created = await page.request.post("/api/my/bands", {
      data: {
        slug: `test-invite-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Duplicate Invite Band",
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    const invitee = testing.username("test_invite_dup_guest")
    const registered = await page.request.post("/api/testing/login", {
      data: { username: invitee, password: TEST_PASSWORD },
    })
    expect(registered.ok(), await registered.text()).toBe(true)
    const verified = await page.request.get(`/api/testing/verify-user?username=${invitee}`)
    expect(verified.ok(), await verified.text()).toBe(true)
    await testing.login({ username: "test_invite_dup_owner" })

    const first = await page.request.post(`/api/my/bands/${band.id}/invite`, {
      data: { username: invitee },
    })
    expect(first.ok(), await first.text()).toBe(true)

    const second = await page.request.post(`/api/my/bands/${band.id}/invite`, {
      data: { username: invitee },
    })
    expect(second.status()).toBe(400)
    expect(await second.text()).toContain("already has an invitation to this band")
  })
})
