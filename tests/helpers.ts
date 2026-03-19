import { test as base, expect, type Page } from "@playwright/test"

const BASE_URL = "http://localhost:3000"

type TestUser = {
  id: string
  username: string
  email: string
  name: string
}

type TestingApi = {
  login(opts?: {
    username?: string
    password?: string
    email?: string
    name?: string
  }): Promise<TestUser>
  clear(): Promise<void>
}

/** Find elements by data-pwid attribute */
const getPw = (page: Page, name: string) =>
  page.locator(`[data-pwid=${name}]`)

/** Login through the UI */
const loginViaUi = async (
  page: Page,
  username: string,
  password: string,
) => {
  await page.goto("/login")
  await getPw(page, "login-id").fill(username)
  await getPw(page, "login-password").fill(password)
  await getPw(page, "login-submit").click()
  await expect(getPw(page, "dashboard")).toBeVisible({ timeout: 5000 })
}

export const test = base.extend<{ testing: TestingApi }>({
  testing: async ({ page }, use) => {
    const testing: TestingApi = {
      async login(opts = {}) {
        const res = await page.request.post(
          `${BASE_URL}/api/testing/login`,
          { data: { username: "test_admin", ...opts } },
        )
        expect(res.ok(), `testing/login failed: ${await res.text()}`).toBe(
          true,
        )
        return res.json()
      },

      async clear() {
        const res = await page.request.post(
          `${BASE_URL}/api/testing/clear`,
        )
        expect(res.ok(), `testing/clear failed: ${await res.text()}`).toBe(
          true,
        )
        // Clear browser cookies after DB cleanup
        await page.context().clearCookies()
      },
    }

    await testing.clear()
    await use(testing)
  },
})

export { expect, getPw, loginViaUi }
