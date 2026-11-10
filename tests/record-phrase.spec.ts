import { renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { test, expect, getPw, createSong, createBareChart } from "./helpers"

// The browser's mic plays a WAV of plucked notes, looped, through the count-in
// and after it. It is not timed to the click and does not contain it, so the
// spec checks that a take's notes reach the phrase, not which rhythm they read
// as. Each worker writes the file; the rename keeps a worker's browser from
// opening a half-written one.
const micFile = join(tmpdir(), "giglist-record-phrase-mic.wav")
writeFileSync(`${micFile}.${process.pid}`, plucks())
renameSync(`${micFile}.${process.pid}`, micFile)
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${micFile}`] },
})

const openPhraseForm = async (page: Page, tempo: number | null) => {
  const { bandId, songId } = await createSong(page, tempo)
  await createBareChart(page, songId)
  await page.goto(`/band/${bandId}/songs/${songId}`)
  await getPw(page, "chart-edit").click()
  const line = getPw(page, "editor-line").filter({ hasText: "Amazing grace" })
  await line.hover()
  await line.getByRole("button", { name: "Add a phrase below" }).click()
}

test("records a take to the click and writes its rhythm into the phrase", async ({ page, testing }) => {
  await testing.login()
  await openPhraseForm(page, 120)
  const status = getPw(page, "phrase-record-status")

  await getPw(page, "phrase-record").click()
  await expect(status).toHaveText(/^Count-in [1-8] of 8\./)
  // Eight count-in beats at 120 BPM last 4 s; then one bar of 2 s.
  await expect(status).toHaveText(/^Bar 2:/, { timeout: 10000 })
  await getPw(page, "phrase-record").click()
  await expect(getPw(page, "phrase-record")).toHaveText("Record again")
  await expect(status).toHaveText(/^Heard \d+ notes\./)
  await expect(getPw(page, "phrase-tex")).toHaveValue(/^\\staff \{slash\}\n/)

  const first = await getPw(page, "phrase-tex").inputValue()
  await getPw(page, "phrase-shift-later").click()
  await expect(status).toContainText("Moved 1 16th later.")
  await expect(getPw(page, "phrase-tex")).not.toHaveValue(first)
})

test("a song with no tempo has no click to record to", async ({ page, testing }) => {
  await testing.login()
  await openPhraseForm(page, null)
  await expect(getPw(page, "phrase-form")).toContainText("Give the song a tempo to record a take to its click.")
  await expect(getPw(page, "phrase-record")).toHaveCount(0)
})

/** Three seconds of 16-bit mono WAV at 48 kHz: a plucked 220 Hz string (five harmonics, decaying) every 300 ms. */
function plucks(): Buffer {
  const rate = 48000
  const frames = 3 * rate
  const every = 0.3 * rate
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    const t = (i % every) / rate
    let sample = 0
    for (let h = 1; h <= 5; h++) sample += Math.sin(2 * Math.PI * 220 * h * t) / h
    data.writeInt16LE(Math.round(0.25 * sample * Math.exp(-t / 0.08) * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write("WAVEfmt ", 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
