import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

test.describe("transfer band ownership", () => {
  test.describe.configure({ timeout: 30000 })

  test("owner makes a member the owner; roles and controls follow", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_to_owner" })
    const created = await page.request.post("/api/my/bands", {
      data: {
        slug: `test-to-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Transfer Ownership Band",
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    const mateName = testing.username("test_to_mate")
    await page.request.post("/api/testing/login", {
      data: { username: mateName, password: TEST_PASSWORD },
    })
    const added = await page.request.post("/api/testing/band-member", {
      data: { band_id: band.id, username: mateName },
    })
    expect(added.ok(), await added.text()).toBe(true)

    await testing.login({ username: "test_to_owner" })
    const members = await page.request.get(`/api/my/bands/${band.id}/members`)
    expect(members.ok()).toBe(true)
    const rows = (await members.json()) as Array<{
      user_id: string
      username: string
      is_owner: boolean
    }>
    const mate = rows.find((m) => m.username === mateName)
    expect(mate).toBeTruthy()

    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-members")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, "band-invite-form")).toBeVisible()

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain(mateName)
      expect(dialog.message()).toMatch(/owner role moves/i)
      return dialog.accept()
    })
    await getPw(page, `band-member-make-owner-${mate!.user_id}`).click()
    await expect(
      page.locator('[data-pwid^="band-member-make-owner-"]'),
    ).toHaveCount(0, { timeout: 5000 })
    await expect(getPw(page, "band-invite-form")).toHaveCount(0)

    await testing.login({ username: "test_to_mate" })
    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-members")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, "band-members").getByText("Owner", { exact: true })).toBeVisible()
    await expect(getPw(page, "band-invite-form")).toBeVisible()

    await testing.login({ username: "test_to_owner" })
    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-members")).toBeVisible({ timeout: 5000 })
    await expect(
      page.locator('[data-pwid^="band-member-make-owner-"]'),
    ).toHaveCount(0)
    await expect(getPw(page, "band-invite-form")).toHaveCount(0)
  })
})
