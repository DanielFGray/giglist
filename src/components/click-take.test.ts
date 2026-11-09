import { describe, expect, test } from "bun:test"
import { COUNT_IN_BEATS } from "~/audio/click/click"
import type { ClickEvent } from "~/audio/click/engine"
import { hitTiles, meterFill, NEW_TAKE, signedMs, takeHits, takeStatus, takeStep } from "./click-take"

const fold = (events: ReadonlyArray<ClickEvent>) => events.reduce(takeStep, NEW_TAKE)

const opened: ReadonlyArray<ClickEvent> = [
  { _tag: "Listening", device: "USB mic", reportedLatencyMs: 20 },
  { _tag: "Beat", beat: 0 },
]

describe("a Listen take", () => {
  test("tells the player what to do at each stage", () => {
    expect(takeStatus(NEW_TAKE, true)).toBe("Opening the microphone…")
    expect(takeStatus(fold(opened), true)).toBe(`Count-in 1 of ${COUNT_IN_BEATS}: listen while the mic measures the click.`)
    const playing = fold([...opened, { _tag: "MeasuredLatency", latencyMs: 87.4, clickLeak: 0.1 }, { _tag: "Note", atMs: 90 }])
    expect(takeStatus(playing, true)).toBe("Play. Speaker-to-mic delay 87 ms.")
    expect(takeStatus(playing, false)).toBe("Stopped after 1 note.")
  })

  test("places each note against the click the player heard", () => {
    // 120 BPM: a beat is 500 ms, and the mic hears each click 80 ms after it is scheduled.
    const take = fold([...opened, { _tag: "MeasuredLatency", latencyMs: 80, clickLeak: 0 }, { _tag: "Note", atMs: 75 }, { _tag: "Note", atMs: 586 }, { _tag: "Note", atMs: 830 }])
    expect(takeHits(take, 120, 1).map((hit) => [hit.beat, hit.step, Math.round(hit.offsetMs)])).toEqual([
      [0, 0, -5],
      [1, 0, 6],
      [2, 0, -250],
    ])
    expect(takeHits(take, 120, 2).map((hit) => [hit.beat, hit.step, Math.round(hit.offsetMs)])).toEqual([
      [0, 0, -5],
      [1, 0, 6],
      [1, 1, 0],
    ])
  })

  test("scores nothing when the mic missed the click, and says why", () => {
    const take = fold([...opened, { _tag: "MissedClick" }, { _tag: "Note", atMs: 600 }])
    expect(takeHits(take, 100, 1)).toEqual([])
    expect(takeStatus(take, true)).toContain("did not hear the click")
  })

  test("a failure stays on screen after the take stops", () => {
    const take = fold([{ _tag: "Failed", reason: "Microphone access was refused." }])
    expect(takeStatus(take, false)).toBe("Microphone access was refused.")
  })

  test("the summary reads as the player would say it", () => {
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
