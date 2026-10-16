import type { Browser, Page } from "@playwright/test"
import { test, expect, getPw, createSetlist, TEST_PASSWORD } from "./helpers"

/** A second signed-in user, in a browser of their own, who is a member of the band. */
const joinBand = async (browser: Browser, page: Page, bandId: string, username: string) => {
  const context = await browser.newContext()
  const other = await context.newPage()
  const login = await other.request.post("/api/testing/login", { data: { username, password: TEST_PASSWORD } })
  expect(login.ok(), await login.text()).toBe(true)
  const added = await page.request.post("/api/testing/band-member", { data: { band_id: bandId, username } })
  expect(added.ok(), await added.text()).toBe(true)
  return { context, other }
}

test.describe("live setlists", () => {
  test("shows who else has the setlist open, and reloads it when they change it", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, setlistId } = await createSetlist(page)
    const { context, other } = await joinBand(browser, page, bandId, "test_second")
    const url = `/band/${bandId}/setlists/${setlistId}`

    await page.goto(url)
    await other.goto(url)
    await expect(getPw(page, "viewer")).toHaveText("test_second", { timeout: 10000 })
    await expect(getPw(other, "viewer")).toHaveText("test_admin", { timeout: 10000 })
    await expect(getPw(page, "setlist-changed")).toHaveCount(0)

    // One adds a section; the other sees it with no reload, and who made it.
    await getPw(page, "section-add-name").fill("Soundcheck")
    await getPw(page, "section-add").click()
    await expect
      .poll(async () => (await getPw(other, "section-name").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).includes("Soundcheck"), { timeout: 10000 })
      .toBe(true)
    await expect(getPw(other, "setlist-changed")).toContainText("test_admin changed this setlist")
    // A writer is not told about their own change.
    await expect(getPw(page, "setlist-changed")).toHaveCount(0)

    // A page that closes leaves the list.
    await context.close()
    await expect(getPw(page, "viewer")).toHaveCount(0, { timeout: 10000 })
  })

  test("opens the stream again after it fails, and reloads what it missed", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, setlistId } = await createSetlist(page)
    const { context, other } = await joinBand(browser, page, bandId, "test_second")

    // The stream is refused, as when the server restarts behind a proxy; the page itself loads. A browser gives up for good on such an answer.
    await other.route("**/events?*", (route) => route.fulfill({ status: 502 }))
    await other.goto(`/band/${bandId}/setlists/${setlistId}`)
    await expect(getPw(other, "section-name")).toHaveCount(2, { timeout: 10000 })
    const added = await page.request.post(`/api/setlists/${setlistId}/sections`, { data: { name: "While away" } })
    expect(added.ok()).toBe(true)
    await other.waitForTimeout(1500)
    await expect(getPw(other, "section-name")).toHaveCount(2)

    // Once the stream can connect, the page opens it again and shows what it missed.
    await other.unroute("**/events?*")
    await expect(getPw(other, "section-name")).toHaveCount(3, { timeout: 15000 })
    await context.close()
  })

  test("a band member can follow another's song in performance mode until they pick their own", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, setlistId } = await createSetlist(page)
    const { context, other } = await joinBand(browser, page, bandId, "test_second")
    const stage = `/band/${bandId}/setlists/${setlistId}/perform`

    await page.goto(stage)
    await other.goto(stage)
    await expect(getPw(page, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(other, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(other, "viewer-follow")).toHaveText("Follow test_admin · song 1", { timeout: 10000 })

    await getPw(other, "viewer-follow").click()
    await expect(getPw(other, "viewer-follow")).toContainText("Following test_admin")
    await page.keyboard.press("ArrowRight")
    await expect(getPw(page, "perform-title")).toHaveText("Beta")
    await expect(getPw(other, "perform-title")).toHaveText("Beta", { timeout: 10000 })
    await expect(other).toHaveURL(/at=2/)

    // Choosing a song yourself stops following.
    await other.keyboard.press("ArrowRight")
    await expect(getPw(other, "perform-title")).toHaveText("Gamma")
    await page.keyboard.press("ArrowLeft")
    await expect(getPw(page, "perform-title")).toHaveText("Alpha")
    await expect(getPw(other, "viewer-follow")).toHaveText("Follow test_admin · song 1", { timeout: 10000 })
    await expect(getPw(other, "perform-title")).toHaveText("Gamma")
    await context.close()
  })

  test("a user outside the band cannot watch a setlist", async ({ page, browser, testing }) => {
    await testing.login()
    const { setlistId } = await createSetlist(page)
    const context = await browser.newContext()
    const stranger = await context.newPage()
    await stranger.request.post("/api/testing/login", { data: { username: "test_stranger", password: TEST_PASSWORD } })
    const watch = await stranger.request.get(`/api/setlists/${setlistId}/events?client=11111111-1111-4111-8111-111111111111`)
    expect(watch.status()).toBe(404)
    const report = await stranger.request.post(`/api/setlists/${setlistId}/presence`, {
      data: { client: "11111111-1111-4111-8111-111111111111", mode: "performing", at: 1 },
    })
    expect(report.status()).toBe(404)
    await context.close()
  })
})
