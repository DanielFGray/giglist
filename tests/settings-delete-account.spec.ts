import { test, expect, getPw, testSlug } from "./helpers"

test.describe("delete account", () => {
  test.describe.configure({ timeout: 30000 })

  test("hides deletion while the user owns a band", async ({ page, testing }) => {
    await testing.login({ username: "test_del_owner" })
    const created = await page.request.post("/api/my/bands", {
      data: { slug: testSlug("del-owned"), name: "Still Owned" },
    })
    expect(created.ok(), await created.text()).toBe(true)

    await page.goto("/settings")
    await expect(getPw(page, "settings-delete-account-blocked")).toBeVisible({
      timeout: 5000,
    })
    await expect(getPw(page, "settings-delete-account")).toHaveCount(0)
  })

  test("deletes the account when the user owns no bands", async ({
    page,
    testing,
  }) => {
    const user = await testing.login({ username: "test_del_free" })
    await page.goto("/settings")
    await expect(getPw(page, "settings-delete-account")).toBeVisible({
      timeout: 5000,
    })

    await getPw(page, "settings-delete-username").fill(user.username)
    await getPw(page, "settings-delete-request").click()
    await expect(getPw(page, "settings-delete-requested")).toBeVisible()

    const secrets = await page.request.get(
      `/api/testing/user-secrets?username=${encodeURIComponent(user.username)}`,
    )
    expect(secrets.ok(), await secrets.text()).toBe(true)
    const body = (await secrets.json()) as { delete_account_token: string | null }
    expect(body.delete_account_token).toBeTruthy()

    await getPw(page, "settings-delete-token").fill(body.delete_account_token!)
    await getPw(page, "settings-delete-confirm").click()
    await expect(getPw(page, "nav-signin")).toBeVisible({ timeout: 5000 })

    const me = await page.request.get("/api/auth/me")
    expect(me.ok()).toBe(true)
    expect(await me.json()).toBeNull()
  })
})
