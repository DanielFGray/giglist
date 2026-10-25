import { test, expect, getPw } from "./helpers"

test.describe("verify notice", () => {
  test("an unverified account sees a notice on home; verifying clears it", async ({
    page,
    testing,
  }) => {
    // testing/login registers without verifying, so a fresh user is unverified.
    const me = await testing.login({ username: "test_verify_notice" })
    await page.goto("/")
    await expect(getPw(page, "verify-notice")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, "verify-notice")).toHaveAttribute("href", "/settings")

    const verified = await page.request.get(
      `/api/testing/verify-user?username=${me.username}`,
    )
    expect(verified.ok(), await verified.text()).toBe(true)
    await page.reload()
    await expect(getPw(page, "dashboard")).toBeVisible({ timeout: 5000 })
    await expect(getPw(page, "verify-notice")).toHaveCount(0)
  })
})
