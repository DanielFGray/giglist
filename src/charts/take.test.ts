import { describe, expect, test } from "vitest"
import { readPhrase } from "./phrase"
import { readTake, type TakeOptions } from "./take"

const BPM = 100
const SLOT_MS = 60_000 / BPM / 4

/** Note times (ms after the first beat) for notes at `slots` (16ths), heard `delayMs` late, each a few ms off. */
function notesAt(slots: ReadonlyArray<number>, delayMs = 30, extra: ReadonlyArray<number> = []): ReadonlyArray<number> {
  const jitter = (i: number) => ((i * 7) % 5) * 4 - 8
  return [...slots.map((s, i) => s * SLOT_MS + delayMs + jitter(i)), ...extra].sort((a, b) => a - b)
}

const options = (o: Partial<TakeOptions> = {}): TakeOptions => ({ bpm: BPM, expectedDelayMs: 20, shift: 0, ...o })
const rhythmOf = (slots: ReadonlyArray<number>, extra: ReadonlyArray<number> = []) => rhythm(readTake(notesAt(slots, 30, extra), options()).tex)

/** What alphaTab reads from the take's alphaTex, bar by bar: duration, then "r" for a rest, "." for a dot, "~" for a tie. */
function rhythm(tex: string | null): string {
  if (tex === null) throw new Error("no phrase")
  const read = readPhrase(tex, null)
  if (!("score" in read)) throw new Error(read.problems.map((p) => p.message).join("; "))
  const staff = read.score.tracks[0]!.staves[0]!
  expect(staff.showSlash && !staff.showStandardNotation && !staff.showTablature).toBe(true)
  return staff.bars
    .map((bar) =>
      bar.voices[0]!.beats
        .map((b) => `${b.duration}${b.isRest ? "r" : ""}${".".repeat(b.dots)}${b.notes.some((n) => n.isTieDestination) ? "~" : ""}`)
        .join(" "),
    )
    .join(" | ")
}

describe("readTake", () => {
  test("snaps notes to 16ths and rests until the first note", () => {
    const reading = readTake(notesAt([2, 4, 6, 8, 10, 12, 14]), options())
    expect(rhythm(reading.tex)).toBe("8r 8 8 8 8 8 8 8")
    expect(reading.delayMs).toBeCloseTo(30, -1)
    expect(reading.driftingBars).toEqual([])
  })

  test("a note holds until the next one, tied across bar lines, and the last fills its bar", () => {
    expect(rhythmOf([0, 6, 20])).toBe("4. 8 2~ | 4~ 4 2~")
    expect(rhythmOf([0, 32])).toBe("1 | 1~ | 1")
  })

  test("bars before the first note are left out", () => {
    expect(rhythmOf([16, 24])).toBe("2 2")
  })

  test("the strings of a strum are one note", () => {
    const strum = [0, 1, 2, 3, 4, 5].map((i) => 8 * SLOT_MS + 30 + i * 12)
    expect(rhythmOf([0], strum)).toBe("2 2")
  })

  test("a sound during the count-in is not a note", () => {
    expect(rhythmOf([0, 8], [-4 * SLOT_MS + 30])).toBe("2 2")
  })

  test("the expected delay picks the slot, and a shift moves a take that read a slot off", () => {
    const late = notesAt([0, 4, 8, 12], 120)
    expect(readTake(late, options({ expectedDelayMs: 100 })).delayMs).toBeCloseTo(120, -1)
    expect(rhythm(readTake(late, options({ expectedDelayMs: 100 })).tex)).toBe("4 4 4 4")

    expect(readTake(late, options({ expectedDelayMs: 0 })).delayMs).toBeCloseTo(-30, -1)
    expect(rhythm(readTake(late, options({ expectedDelayMs: 0 })).tex)).toBe("16r 16 8~ 16~ 16 8~ 16~ 16 8~ 16~ 16 8~")
    expect(rhythm(readTake(late, options({ expectedDelayMs: 0, shift: -1 })).tex)).toBe("4 4 4 4")
  })

  test("a bar whose notes sit between slots is flagged", () => {
    const dragging = [16, 20, 24, 28].map((s) => (s + 0.45) * SLOT_MS + 30)
    const reading = readTake(notesAt([0, 2, 4, 6, 8, 10, 12, 14], 30, dragging), options())
    expect(reading.driftingBars.map((b) => b.bar)).toEqual([1])
    expect(reading.driftingBars[0]!.drift).toBeGreaterThan(0.25)
  })

  test("a take with no notes after the count-in has no phrase", () => {
    expect(readTake([], options()).tex).toBeNull()
  })
})
