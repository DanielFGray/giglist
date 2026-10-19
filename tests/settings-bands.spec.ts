import { test, expect, getPw, TEST_PASSWORD } from "./helpers"

test.describe("settings bands", () => {
  test.describe.configure({ timeout: 30000 })

  test("sole owner deletes the band after typing its name", async ({
    page,
    testing,
  }) => {
    await testing.login({ username: "test_settings_sole" })
    const created = await page.request.post("/api/my/bands", {
      data: { slug: "test-settings-sole", name: "Solo Delete Band" },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string; name: string }

    await page.goto("/settings")
    await expect(getPw(page, "settings-bands")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, `settings-band-${band.id}`)).toContainText(
      "Solo Delete Band",
    )

    await getPw(page, `settings-band-confirm-${band.id}`).fill(band.name)
    await getPw(page, `settings-band-delete-${band.id}`).click()
    await expect(getPw(page, `settings-band-${band.id}`)).toHaveCount(0)

    const list = await page.request.get("/api/my/bands")
    expect(list.ok()).toBe(true)
    const bands = (await list.json()) as Array<{ id: string }>
    expect(bands.some((b) => b.id === band.id)).toBe(false)
  })

  test("owner transfers ownership and leaves", async ({ page, testing }) => {
    await testing.login({ username: "test_settings_owner" })
    const created = await page.request.post("/api/my/bands", {
      data: { slug: "test-settings-xfer", name: "Transfer Band" },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    // Register the mate (sets the cookie to them), add them to the band, then
    // restore the owner for the settings UI.
    await page.request.post("/api/testing/login", {
      data: { username: "test_settings_mate", password: TEST_PASSWORD },
    })
    const added = await page.request.post("/api/testing/band-member", {
      data: { band_id: band.id, username: "test_settings_mate" },
    })
    expect(added.ok(), await added.text()).toBe(true)
    await testing.login({ username: "test_settings_owner" })

    await page.goto("/settings")
    await expect(getPw(page, `settings-band-${band.id}`)).toBeVisible({
      timeout: 5000,
    })

    const members = await page.request.get(`/api/my/bands/${band.id}/members`)
    expect(members.ok()).toBe(true)
    const rows = (await members.json()) as Array<{
      user_id: string
      username: string
      is_owner: boolean
    }>
    const mate = rows.find((m) => m.username === "test_settings_mate")
    expect(mate).toBeTruthy()

    await getPw(page, `settings-band-successor-${band.id}`).selectOption(
      mate!.user_id,
    )
    await getPw(page, `settings-band-transfer-leave-${band.id}`).click()
    await expect(getPw(page, `settings-band-${band.id}`)).toHaveCount(0)

    await testing.login({ username: "test_settings_mate" })
    const after = await page.request.get(`/api/my/bands/${band.id}/members`)
    expect(after.ok()).toBe(true)
    const afterRows = (await after.json()) as Array<{
      username: string
      is_owner: boolean
    }>
    expect(afterRows).toHaveLength(1)
    expect(afterRows[0]?.username).toBe("test_settings_mate")
    expect(afterRows[0]?.is_owner).toBe(true)
  })

  test("non-owner leaves without transferring", async ({ page, testing }) => {
    await testing.login({ username: "test_settings_host" })
    const created = await page.request.post("/api/my/bands", {
      data: { slug: "test-settings-leave", name: "Leave Band" },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const band = (await created.json()) as { id: string }

    await page.request.post("/api/testing/login", {
      data: { username: "test_settings_guest", password: TEST_PASSWORD },
    })
    const added = await page.request.post("/api/testing/band-member", {
      data: { band_id: band.id, username: "test_settings_guest" },
    })
    expect(added.ok(), await added.text()).toBe(true)

    await page.goto("/settings")
    await expect(getPw(page, `settings-band-${band.id}`)).toBeVisible({
      timeout: 5000,
    })
    await getPw(page, `settings-band-leave-${band.id}`).click()
    await expect(getPw(page, `settings-band-${band.id}`)).toHaveCount(0)

    const list = await page.request.get("/api/my/bands")
    const bandsList = (await list.json()) as Array<{ id: string }>
    expect(bandsList.some((b) => b.id === band.id)).toBe(false)
  })
})
