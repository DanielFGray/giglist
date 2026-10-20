import type { Browser, Page } from "@playwright/test"
import { test, expect, getPw, createGig, TEST_PASSWORD } from "./helpers"

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

/** The "Set 1" setlist's songs, as rows of its grid. */
const songRows = (page: Page) => getPw(page, "setlist-grid").locator('[data-pwid="grid-row"]')

test.describe("live setlists", () => {
  test("shows who else has the setlist open, and reloads it when they change it", async ({ page, browser, testing }) => {
    const me = await testing.login()
    const second = testing.username("test_second")
    const { bandId, setlistId } = await createGig(page)
    const { context, other } = await joinBand(browser, page, bandId, second)
    const url = `/band/${bandId}/setlists/${setlistId}`

    await page.goto(url)
    await other.goto(url)
    await expect(getPw(page, "viewer")).toHaveText(second, { timeout: 10000 })
    await expect(getPw(other, "viewer")).toHaveText(me.username, { timeout: 10000 })
    await expect(getPw(page, "setlist-changed")).toHaveCount(0)

    // One adds a song in the grid; the other sees it with no reload, and who added it.
    await getPw(page, "grid-new-row").locator('[data-pwid="cell-title"]').click()
    await page.keyboard.type("Gamma")
    await page.keyboard.press("Enter")
    await expect(songRows(page)).toHaveCount(3, { timeout: 10000 })
    await expect(songRows(other)).toHaveCount(3, { timeout: 10000 })
    await expect(getPw(other, "setlist-changed")).toContainText(`${me.username} changed this setlist`)
    // A writer is not told about their own change.
    await expect(getPw(page, "setlist-changed")).toHaveCount(0)

    // A page that closes leaves the list.
    await context.close()
    await expect(getPw(page, "viewer")).toHaveCount(0, { timeout: 10000 })
  })

  test("a change to a setlist reaches the page of every gig that plays it", async ({ page, browser, testing }) => {
    const me = await testing.login()
    const { bandId, gigId, setlistId } = await createGig(page)
    const { context, other } = await joinBand(browser, page, bandId, testing.username("test_second"))

    await other.goto(`/band/${bandId}/gigs/${gigId}`)
    await expect(getPw(other, "gig-setlist").first()).toContainText("2 songs", { timeout: 10000 })
    const entries = (await (await page.request.get(`/api/setlists/${setlistId}/entries`)).json()) as Array<{ song_id: string }>
    const added = await page.request.post(`/api/setlists/${setlistId}/entries`, { data: { song_id: entries[0]!.song_id } })
    expect(added.ok(), await added.text()).toBe(true)

    await expect(getPw(other, "gig-setlist").first()).toContainText("3 songs", { timeout: 10000 })
    await expect(getPw(other, "gig-changed")).toContainText(`${me.username} changed this gig`)
    await context.close()
  })

  test("a gig that starts playing a setlist shows up on that setlist's open page", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, gigId } = await createGig(page)
    const { context, other } = await joinBand(browser, page, bandId, testing.username("test_second"))
    const spare = (await (await page.request.post("/api/setlists", { data: { band_id: bandId, name: "Spare" } })).json()) as { id: string }

    await other.goto(`/band/${bandId}/setlists/${spare.id}`)
    await expect(getPw(other, "setlist-gig")).toHaveCount(0, { timeout: 10000 })
    const added = await page.request.post(`/api/gigs/${gigId}/setlists`, { data: { setlist_id: spare.id } })
    expect(added.ok(), await added.text()).toBe(true)
    await expect(getPw(other, "setlist-gig")).toHaveText(["Friday"], { timeout: 10000 })
    await context.close()
  })

  test("opens the stream again after it fails, and reloads what it missed", async ({ page, browser, testing }) => {
    await testing.login()
    const { bandId, setlistId } = await createGig(page)
    const { context, other } = await joinBand(browser, page, bandId, testing.username("test_second"))

    // The stream is refused, as when the server restarts behind a proxy; the page itself loads. A browser gives up for good on such an answer.
    await other.route("**/events?*", (route) => route.fulfill({ status: 502 }))
    await other.goto(`/band/${bandId}/setlists/${setlistId}`)
    await expect(songRows(other)).toHaveCount(2, { timeout: 10000 })
    const entries = (await (await page.request.get(`/api/setlists/${setlistId}/entries`)).json()) as Array<{ song_id: string }>
    const added = await page.request.post(`/api/setlists/${setlistId}/entries`, { data: { song_id: entries[0]!.song_id } })
    expect(added.ok()).toBe(true)
    // The refused stream cannot deliver the write while this page is away.
    await expect(songRows(other)).toHaveCount(2, { timeout: 5000 })

    // Once the stream can connect, the page opens it again and shows what it missed.
    await other.unroute("**/events?*")
    await expect(songRows(other)).toHaveCount(3, { timeout: 15000 })
    await context.close()
  })

  test("a band member can follow another's song in performance mode until they pick their own", async ({ page, browser, testing }) => {
    const me = await testing.login()
    const { bandId, gigId } = await createGig(page)
    const { context, other } = await joinBand(browser, page, bandId, testing.username("test_second"))
    const stage = `/band/${bandId}/gigs/${gigId}/perform`

    await page.goto(stage)
    await other.goto(stage)
    await expect(getPw(page, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(other, "perform-title")).toHaveText("Alpha", { timeout: 10000 })
    await expect(getPw(other, "viewer-follow")).toHaveText(`Follow ${me.username} · song 1`, { timeout: 10000 })

    await getPw(other, "viewer-follow").click()
    await expect(getPw(other, "viewer-follow")).toContainText(`Following ${me.username}`)
    await page.keyboard.press("ArrowRight")
    await expect(getPw(page, "perform-title")).toHaveText("Beta")
    await expect(getPw(other, "perform-title")).toHaveText("Beta", { timeout: 10000 })
    await expect(other).toHaveURL(/at=2/)

    // Choosing a song yourself stops following.
    await other.keyboard.press("ArrowRight")
    await expect(getPw(other, "perform-title")).toHaveText("Gamma")
    await page.keyboard.press("ArrowLeft")
    await expect(getPw(page, "perform-title")).toHaveText("Alpha")
    await expect(getPw(other, "viewer-follow")).toHaveText(`Follow ${me.username} · song 1`, { timeout: 10000 })
    await expect(getPw(other, "perform-title")).toHaveText("Gamma")
    await context.close()
  })

  test("a user outside the band cannot watch a setlist or a gig", async ({ page, browser, testing }) => {
    await testing.login()
    const { setlistId, gigId } = await createGig(page)
    const context = await browser.newContext()
    const stranger = await context.newPage()
    await stranger.request.post("/api/testing/login", { data: { username: testing.username("test_stranger"), password: TEST_PASSWORD } })
    for (const room of [`/api/setlists/${setlistId}`, `/api/gigs/${gigId}`]) {
      const watch = await stranger.request.get(`${room}/events?client=11111111-1111-4111-8111-111111111111`)
      expect(watch.status(), room).toBe(404)
      const report = await stranger.request.post(`${room}/presence`, {
        data: { client: "11111111-1111-4111-8111-111111111111", mode: "performing", at: 1 },
      })
      expect(report.status(), room).toBe(404)
    }
    await context.close()
  })
})
