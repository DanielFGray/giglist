import { degreeName } from "./degrees"
import { staffNotes } from "./staff"
import { NATURALS, type Spelling } from "alphatab-kit/charts/spelling"

/** A key the chord presses: its pitch, the name the chord spells it with, and its degree. */
export type PianoNote = {
  /** MIDI number: C4 is 60. */
  readonly pitch: number
  /** The note name as the chord spells it: `Eb`, `F#`, `G`. */
  readonly name: string
  /** `R`, `3`, `b7` and so on; null for a slash bass the chord does not name. */
  readonly degree: string | null
}

/**
 * The keys one chord presses, lowest first. They are the notes the staff view
 * stacks, so both views agree on the octave, the spelling and the slash bass.
 * Pure and free of the DOM, so the diagram and the tests share it.
 */
export function pianoNotes(chord: Spelling): ReadonlyArray<PianoNote> {
  const notes = staffNotes(chord).map((note) => {
    const semitones = note.degree === null ? undefined : chord.tones.get(note.degree)
    return {
      pitch: (note.octave + 1) * 12 + NATURALS[note.letter]! + note.accidental,
      name: note.letter + (note.accidental > 0 ? "#".repeat(note.accidental) : "b".repeat(-note.accidental)),
      degree: note.degree === null || semitones === undefined ? null : degreeName(note.degree, semitones),
    }
  })
  return notes.sort((a, b) => a.pitch - b.pitch)
}

/**
 * The pitches a keyboard drawn for these notes spans: from the white key at or
 * below the lowest note, less one white key, to the white key at or above the
 * highest, plus one. Both ends are white keys, so no black key hangs off an edge.
 */
export function keyRange(pitches: ReadonlyArray<number>): { readonly low: number; readonly high: number } {
  let low = Math.min(...pitches)
  let high = Math.max(...pitches)
  while (isBlack(low)) low -= 1
  while (isBlack(high)) high += 1
  return { low: previousWhite(low), high: nextWhite(high) }
}

export function isBlack(pitch: number): boolean {
  return BLACK.has(((pitch % 12) + 12) % 12)
}

const BLACK: ReadonlySet<number> = new Set([1, 3, 6, 8, 10])

function previousWhite(pitch: number): number {
  let p = pitch - 1
  while (isBlack(p)) p -= 1
  return p
}

function nextWhite(pitch: number): number {
  let p = pitch + 1
  while (isBlack(p)) p += 1
  return p
}
