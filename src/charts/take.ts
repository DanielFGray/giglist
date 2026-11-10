import { BEATS_PER_BAR } from "~/audio/click/click"

/**
 * Reading a take's rhythm (docs/adr/0013): the notes of a recording played to
 * the click become a slash staff in alphaTex. The grid is 16th notes in the
 * click's bars (songs have no time signature yet), counted from the first beat
 * after the click's count-in.
 */

/** Grid slots per beat: 16th notes. */
const SLOTS_PER_BEAT = 4
const SLOTS_PER_BAR = BEATS_PER_BAR * SLOTS_PER_BEAT
/** A bar whose notes sit, on average, this far from their slots (in slots) is flagged. */
const DRIFT_LIMIT = 0.25

export type TakeOptions = {
  readonly bpm: number
  /**
   * The click-to-recording delay expected before the notes are read, in ms:
   * measured from the count-in clicks when the microphone heard them,
   * otherwise the delay the browser reports. It decides which slot a note
   * belongs to.
   */
  readonly expectedDelayMs: number
  /** Slots to move every note, for a take that read a slot early or late as a whole. */
  readonly shift: number
}

export type TakeReading = {
  /** A slash staff, or null when no note was played after the count-in. */
  readonly tex: string | null
  /** The delay the take's notes show, in ms. */
  readonly delayMs: number
  /** Bars (0 is the phrase's first) whose notes sit between slots: `drift` is their mean distance from their slots, in slots, late positive. */
  readonly driftingBars: ReadonlyArray<{ readonly bar: number; readonly drift: number }>
}

/**
 * The rhythm of a take whose notes started `notesMs` after the first beat
 * after the count-in was scheduled to sound (the click engine's Note events).
 * Its delay is the notes' common offset from the grid (their circular mean, so
 * notes on either side of a slot pull it the same way), placed in the grid
 * slot nearest the expected delay. Sounds during the count-in are not notes.
 */
export function readTake(notesMs: ReadonlyArray<number>, { bpm, expectedDelayMs, shift }: TakeOptions): TakeReading {
  const slotMs = 60_000 / bpm / SLOTS_PER_BEAT
  // Positions in slots from the first beat, before the delay is taken off.
  const played = notesMs.map((t) => t / slotMs).filter((p) => p > -0.5)
  const delay = nearest(circularMean(played), expectedDelayMs / slotMs)
  const events = joinStrums(played.map((p) => p - delay))
  const slots = events.map((p) => Math.round(p) + shift)
  return {
    // Two events half a slot apart can round to one slot.
    tex: slots.length === 0 ? null : slashStaff([...new Set(slots)]),
    delayMs: delay * slotMs,
    driftingBars: driftingBars(events, slots, shift),
  }
}

/**
 * alphaTex for notes starting at `slots` (sorted, from the first beat after
 * the count-in). Bars before the first note are left out. Each note lasts
 * until the next one, or to the end of its bar for the last.
 */
function slashStaff(slots: ReadonlyArray<number>): string {
  const firstBar = Math.floor(slots[0]! / SLOTS_PER_BAR)
  const starts = slots.map((s) => s - firstBar * SLOTS_PER_BAR)
  const end = (Math.floor(starts.at(-1)! / SLOTS_PER_BAR) + 1) * SLOTS_PER_BAR
  const bars: Array<Array<string>> = Array.from({ length: end / SLOTS_PER_BAR }, () => [])
  // A note longer than one value continues as tied notes; a rest needs no tie.
  const write = (from: number, to: number, note: boolean) =>
    pieces(from, to).forEach((piece, i) => {
      // alphaTex puts a tie on the note and a dot on the beat: `C4{t}.4{d}`.
      const head = note ? (i > 0 ? "C4{t}" : "C4") : "r"
      bars[Math.floor(piece.at / SLOTS_PER_BAR)]!.push(`${head}.${piece.value.duration}${piece.value.dotted ? "{d}" : ""}`)
    })
  if (starts[0]! > 0) write(0, starts[0]!, false)
  starts.forEach((start, i) => write(start, starts[i + 1] ?? end, true))
  return `\\staff {slash}\n${bars.map((b) => b.join(" ")).join(" | ")}`
}

type NoteValue = { readonly slots: number; readonly duration: 1 | 2 | 4 | 8 | 16; readonly dotted: boolean }

/** Note values from longest to shortest, in slots. */
const VALUES: ReadonlyArray<NoteValue> = [
  { slots: 16, duration: 1, dotted: false },
  { slots: 12, duration: 2, dotted: true },
  { slots: 8, duration: 2, dotted: false },
  { slots: 6, duration: 4, dotted: true },
  { slots: 4, duration: 4, dotted: false },
  { slots: 3, duration: 8, dotted: true },
  { slots: 2, duration: 8, dotted: false },
  { slots: 1, duration: 16, dotted: false },
]

/**
 * The note values that fill `[from, to)`, longest first. A value starts only
 * where its length divides the bar (twice the undotted length for a dotted
 * value), so each beat and the middle of the bar stay visible and no value
 * crosses a bar line.
 */
function pieces(from: number, to: number): ReadonlyArray<{ readonly at: number; readonly value: NoteValue }> {
  const out: Array<{ at: number; value: NoteValue }> = []
  for (let at = from; at < to; ) {
    const inBar = at % SLOTS_PER_BAR
    const value = VALUES.find((v) => v.slots <= to - at && inBar % (v.dotted ? (v.slots / 3) * 4 : v.slots) === 0)!
    out.push({ at, value })
    at += value.slots
  }
  return out
}

/**
 * Onsets closer than half a slot are one event, kept at the first: the strings
 * of a strum, which no 16th grid can hold apart.
 */
function joinStrums(positions: ReadonlyArray<number>): ReadonlyArray<number> {
  const out: Array<number> = []
  for (const p of positions) if (out.length === 0 || p - out.at(-1)! >= 0.5) out.push(p)
  return out
}

/** Bars whose events sit, on average, more than `DRIFT_LIMIT` slots from the slots they snapped to. */
function driftingBars(events: ReadonlyArray<number>, slots: ReadonlyArray<number>, shift: number) {
  const byBar = new Map<number, Array<number>>()
  events.forEach((p, i) => {
    const bar = Math.floor(slots[i]! / SLOTS_PER_BAR)
    byBar.set(bar, [...(byBar.get(bar) ?? []), p + shift - slots[i]!])
  })
  const first = slots.length === 0 ? 0 : Math.floor(slots[0]! / SLOTS_PER_BAR)
  return [...byBar]
    .map(([bar, offsets]) => ({ bar: bar - first, drift: offsets.reduce((a, b) => a + b, 0) / offsets.length }))
    .filter((b) => Math.abs(b.drift) > DRIFT_LIMIT)
}

/** The mean position of `positions` within a slot, in (-0.5, 0.5], treating a slot as a circle (Fisher, Statistical Analysis of Circular Data, 1993). */
function circularMean(positions: ReadonlyArray<number>): number {
  if (positions.length === 0) return 0
  let x = 0
  let y = 0
  for (const p of positions) {
    x += Math.cos(2 * Math.PI * p)
    y += Math.sin(2 * Math.PI * p)
  }
  return Math.atan2(y, x) / (2 * Math.PI)
}

/** `phase` plus the whole number of slots that puts it nearest `target`. */
function nearest(phase: number, target: number): number {
  return phase + Math.round(target - phase)
}
