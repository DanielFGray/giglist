import { test, expect, getPw, TEST_PASSWORD, testSlug } from "./helpers"

test.describe("remove band member", () => {
  test.describe.configure({ timeout: 30000 })

  test("owner removes a member and that member loses band access", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_rm_owner" })
    const created = await page.request.post("/api/my/bands", {
      data: {
        slug: testSlug("rm"),
        name: "Remove Member Band",
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    const mateName = testing.username("test_rm_mate")
    await page.request.post("/api/testing/login", {
      data: { username: mateName, password: TEST_PASSWORD },
    })
    const added = await page.request.post("/api/testing/band-member", {
      data: { band_id: band.id, username: mateName },
    })
    expect(added.ok(), await added.text()).toBe(true)

    // Member can read songs before removal.
    expect((await page.request.get(`/api/songs/band/${band.id}`)).status()).toBe(
      200,
    )

    await testing.login({ username: "test_rm_owner" })
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

    page.once("dialog", (dialog) => dialog.accept())
    await getPw(page, `band-member-remove-${mate!.user_id}`).click()
    await expect(getPw(page, `band-member-remove-${mate!.user_id}`)).toHaveCount(
      0,
      { timeout: 5000 },
    )

    await testing.login({ username: "test_rm_mate" })
    expect((await page.request.get(`/api/songs/band/${band.id}`)).status()).not.toBe(
      200,
    )
  })

  test("owner has no Remove on their own row; API refuses self-removal", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_rm_self" })
    const created = await page.request.post("/api/my/bands", {
      data: {
        slug: testSlug("rm-self"),
        name: "Self Remove Band",
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    const mateName = testing.username("test_rm_self_mate")
    await page.request.post("/api/testing/login", {
      data: { username: mateName, password: TEST_PASSWORD },
    })
    const added = await page.request.post("/api/testing/band-member", {
      data: { band_id: band.id, username: mateName },
    })
    expect(added.ok(), await added.text()).toBe(true)

    await testing.login({ username: "test_rm_self" })
    const members = await page.request.get(`/api/my/bands/${band.id}/members`)
    const rows = (await members.json()) as Array<{
      user_id: string
      is_owner: boolean
    }>
    const owner = rows.find((m) => m.is_owner)
    expect(owner).toBeTruthy()

    await page.goto(`/band/${band.id}`)
    await expect(getPw(page, "band-members")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, `band-member-remove-${owner!.user_id}`)).toHaveCount(
      0,
    )

    const refused = await page.request.delete(
      `/api/my/bands/${band.id}/members/${owner!.user_id}`,
    )
    expect(refused.status()).toBe(400)
    expect(await refused.text()).toContain("Use Leave to remove yourself")
  })

  test("non-owner member sees no Remove buttons", async ({ page, testing }) => {
    await testing.login({ username: "test_rm_host" })
    const created = await page.request.post("/api/my/bands", {
      data: {
        slug: testSlug("rm-host"),
        name: "Non-owner View Band",
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    const guestName = testing.username("test_rm_guest")
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
    await expect(page.locator('[data-pwid^="band-member-remove-"]')).toHaveCount(0)
  })
})
