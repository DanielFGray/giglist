import { describe, expect, test } from "bun:test"
import { COUNT_IN_BEATS } from "~/audio/click/click"
import type { ClickEvent } from "~/audio/click/engine"
import { NEW_TAKE, takeStep } from "~/audio/click/take"
import { hitTiles, meterFill, signedMs, takeStatus } from "./click-take"

const fold = (events: ReadonlyArray<ClickEvent>) => events.reduce(takeStep, NEW_TAKE)

const opened: ReadonlyArray<ClickEvent> = [
  { _tag: "Listening", device: "USB mic", reportedLatencyMs: 20 },
  { _tag: "Beat", beat: 0 },
]

describe("Listen mode's words", () => {
  test("tell the player what to do at each stage", () => {
    expect(takeStatus(NEW_TAKE, true)).toBe("Opening the microphone…")
    expect(takeStatus(fold(opened), true)).toBe(`Count-in 1 of ${COUNT_IN_BEATS}: listen while the mic measures the click.`)
    const playing = fold([...opened, { _tag: "MeasuredLatency", latencyMs: 87.4, clickLeak: 0.1 }, { _tag: "Note", atMs: 90 }])
    expect(takeStatus(playing, true)).toBe("Play. Speaker-to-mic delay 87 ms.")
    expect(takeStatus(playing, false)).toBe("Stopped after 1 note.")
  })

  test("say why a take cannot be scored, during it and after it stops", () => {
    const missed = fold([...opened, { _tag: "MissedClick" }])
    expect(takeStatus(missed, true)).toContain("did not hear the click")
    expect(takeStatus(missed, false)).toContain("did not hear the click")
    expect(takeStatus(fold([{ _tag: "Failed", reason: "Microphone access was refused." }]), false)).toBe("Microphone access was refused.")
  })

  test("summarise the notes as the player would say it", () => {
    expect(hitTiles([])).toEqual([
      ["Notes", "0"],
      ["Average", "—"],
      ["Spread", "—"],
      ["Within ±10 ms", "—"],
    ])
    const hits = [-20, -4, -6].map((offsetMs, beat) => ({ offsetMs, beat, step: 0 }))
    expect(hitTiles(hits)).toEqual([
      ["Notes", "3"],
      ["Average", "−10.0 ms rushing"],
      ["Spread", "±7.1 ms"],
      ["Within ±10 ms", "67%"],
    ])
    expect(signedMs(4.25)).toBe("+4.3 ms")
    expect(signedMs(0)).toBe("±0.0 ms")
  })

  test("the meter spans -60 to 0 dBFS", () => {
    expect(meterFill(0)).toBe(0)
    expect(meterFill(0.001)).toBe(0)
    expect(meterFill(1)).toBe(1)
    expect(meterFill(0.0316)).toBeCloseTo(0.5, 2)
  })
})
