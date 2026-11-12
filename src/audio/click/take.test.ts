import { describe, expect, test } from "vitest"
import type { ClickEvent } from "./engine"
import { NEW_TAKE, takeHits, takeStep } from "./take"

const fold = (events: ReadonlyArray<ClickEvent>) => events.reduce(takeStep, NEW_TAKE)

const opened: ReadonlyArray<ClickEvent> = [
  { _tag: "Listening", device: "USB mic", reportedLatencyMs: 20 },
  { _tag: "Beat", beat: 0 },
]

describe("a take", () => {
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

  test("after a missed click it keeps the notes and the browser's delay, but scores nothing", () => {
    const take = fold([...opened, { _tag: "MissedClick" }, { _tag: "Note", atMs: 620 }])
    expect(take.missedClick).toBe(true)
    expect(take.failure).toBeNull()
    expect(take.notesMs).toEqual([620])
    expect(take.reportedLatencyMs).toBe(20)
    expect(takeHits(take, 100, 1)).toEqual([])
  })
})
