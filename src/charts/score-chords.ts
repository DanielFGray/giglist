/**
 * Chords worked out from the notes of a Guitar Pro score, for a file whose
 * author named none (docs/adr/0007). Pure: it reads alphaTab's model and
 * nothing else.
 *
 * Each bar is heard as pitch classes weighted by how long they sound on every
 * pitched track, and by the lowest note sounding. Every root with every
 * quality is scored against that: its notes count for it, notes outside it
 * count against it, a chord note that never sounds costs, and the lowest note
 * on the root adds. A bar is split into halves when two chords explain it
 * clearly better than one.
 */
import type { model } from "@coderline/alphatab"
import { spell, type PitchClass } from "alphatab-kit/charts/spelling"

/** A chord without a name yet: the name depends on the song's key. */
export type HeardChord = { readonly at: number; readonly root: PitchClass; readonly quality: Quality }

/** A plain major or minor triad, or a power chord (root and fifth). */
export type Quality = "" | "m" | "5"

/**
 * One or two chords for each bar in `played`, the bars in playing order with
 * `at` their start in ticks. A bar where nothing sounds gets none.
 */
export function inferChords(
  score: model.Score,
  played: ReadonlyArray<{ readonly bar: model.MasterBar; readonly at: number }>,
): Array<HeardChord> {
  const out: Array<HeardChord> = []
  for (const p of played) {
    const length = p.bar.calculateDuration()
    const whole = heard(score, p.bar.index, 0, length)
    if (whole.total === 0) continue
    const one = bestChord(whole)
    const half = length / 2
    const first = heard(score, p.bar.index, 0, half)
    const second = heard(score, p.bar.index, half, length)
    if (first.total > 0 && second.total > 0) {
      const a = bestChord(first)
      const b = bestChord(second)
      const splitFit = (a.fit * first.total + b.fit * second.total) / whole.total
      if ((a.root !== b.root || a.quality !== b.quality) && splitFit - one.fit > SPLIT_GAIN) {
        out.push({ at: p.at, root: a.root, quality: a.quality }, { at: p.at + half, root: b.root, quality: b.quality })
        continue
      }
    }
    out.push({ at: p.at, root: one.root, quality: one.quality })
  }
  return out
}

/**
 * Sevenths, sus chords and maj7 are not tried: melody notes made them win on
 * plain chords. Each quality costs a little for being less plain than a triad.
 */
const QUALITIES: ReadonlyArray<readonly [Quality, number]> = [["", 0], ["m", 0], ["5", 0.02]]

const TEMPLATES = Array.from({ length: 12 }, (_, root) =>
  QUALITIES.map(([quality, cost]) => {
    // Any spelling of the root gives the same pitch classes.
    const s = spell(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][root]! + quality)!
    return { root, quality, required: new Set(s.required), optional: new Set(s.optional), cost }
  }),
).flat()

/** How much better, as a share of the bar's sound, two chords must fit than one to split a bar. */
const SPLIT_GAIN = 0.15
/** How much the lowest note on the root counts, against the share of all notes in the chord. */
const BASS_WEIGHT = 1
/** What a chord note that never sounds costs. */
const MISSING_COST = 0.25

type Heard = { readonly weights: Float64Array; readonly bass: Float64Array; readonly total: number }

/** Pitch-class weights sounding in ticks [from, to) of a bar, across the pitched tracks. */
function heard(score: model.Score, barIndex: number, from: number, to: number): Heard {
  const weights = new Float64Array(12)
  const bass = new Float64Array(12)
  let total = 0
  for (const beat of pitchedBeats(score, barIndex)) {
    const time = Math.min(to, beat.playbackStart + beat.playbackDuration) - Math.max(from, beat.playbackStart)
    const notes = beat.notes.filter((n) => !n.isDead)
    if (time <= 0 || beat.isRest || notes.length === 0) continue
    let lowest = Infinity
    for (const note of notes) {
      const pitch = note.realValueWithoutHarmonic
      weights[pitchClass(pitch)]! += time
      total += time
      lowest = Math.min(lowest, pitch)
    }
    bass[pitchClass(lowest)]! += time
  }
  return { weights, bass, total }
}

/** Every beat of a bar on every staff that is not drums. */
function pitchedBeats(score: model.Score, barIndex: number): Array<model.Beat> {
  return score.tracks.flatMap((track) =>
    track.staves.filter((staff) => !staff.isPercussion).flatMap((staff) => staff.bars[barIndex]?.voices.flatMap((voice) => voice.beats) ?? []),
  )
}

/** The best-scoring chord for what was heard; `fit` is its score as a share of the sound. */
function bestChord(h: Heard): { root: PitchClass; quality: Quality; fit: number } {
  const bassTotal = h.bass.reduce((a, b) => a + b, 0) || 1
  let best = { root: 0, quality: "" as Quality, fit: -Infinity }
  for (const t of TEMPLATES) {
    let fit = 0
    for (let pc = 0; pc < 12; pc++) {
      const share = h.weights[pc]! / h.total
      if (t.required.has(pc)) fit += share
      else if (t.optional.has(pc)) fit += share / 2
      else fit -= share
    }
    for (const pc of t.required) if (h.weights[pc] === 0) fit -= MISSING_COST
    fit += BASS_WEIGHT * (h.bass[t.root]! / bassTotal) - t.cost
    if (fit > best.fit) best = { root: t.root, quality: t.quality, fit }
  }
  return best
}

function pitchClass(midi: number): PitchClass {
  return ((midi % 12) + 12) % 12
}
