import { test, expect, getPw, createGig } from "./helpers"

// Chromium's fake capture device stands in for the mic. It plays its own tone
// and does not hear the click, so the count-in can end either way.
test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } })

test("Listen opens the mic, runs the count-in and keeps its result after it stops", async ({ page, testing }) => {
  await testing.login()
  const { bandId, gigId } = await createGig(page)
  await page.goto(`/band/${bandId}/gigs/${gigId}/perform`)
  await expect(getPw(page, "perform-title")).toHaveText("Alpha", { timeout: 10000 })

  await getPw(page, "perform-click-listen").click()
  await expect(getPw(page, "perform-click-panel")).toContainText("Listening on")
  await expect(getPw(page, "perform-click-status")).toHaveText(/^Count-in [1-8] of 8/)
  // Eight count-in beats at 120 BPM last 4 s.
  await expect(getPw(page, "perform-click-status")).toHaveText(/did not hear the click|^Play\./, { timeout: 8000 })
  const missed = (await getPw(page, "perform-click-status").textContent())?.includes("did not hear") ?? false

  await getPw(page, "perform-click-listen").click()
  await expect(getPw(page, "perform-click-listen")).toHaveText("Listen")
  await expect(getPw(page, "perform-click-panel")).not.toContainText("Listening on")
  await expect(getPw(page, "perform-click-status")).toHaveText(missed ? /did not hear the click/ : /^Stopped after \d+ notes?\.$/)

  await getPw(page, "perform-click-close").click()
  await expect(getPw(page, "perform-click-panel")).toHaveCount(0)
})
