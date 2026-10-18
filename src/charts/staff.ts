import { NATURALS, type Spelling } from "./spelling"

export type StaffNote = {
  readonly letter: string
  /** Sharps or flats from the letter's natural pitch, -3 (triple flat) to 3 (triple sharp). */
  readonly accidental: number
  /** Scientific pitch octave: the root sits in 4, extensions above it in 5 and higher. */
  readonly octave: number
  /** Chord degree the note spells, or null for a slash bass outside the chord. */
  readonly degree: number | null
}

/**
 * The chord's tones as stacked whole notes on a treble staff, bottom to top.
 * Every tone in spelling.tones sounds, required and optional alike: the staff
 * is a theory picture, the same for every instrument. Degree d sits d-1
 * letter steps above the root, so 9, 11 and 13 sit above the octave; a 6th
 * spells as a 13th and so draws above the octave too. A slash bass different
 * from the root sounds first, at the nearest pitch below the root.
 */
export function staffNotes(spelling: Spelling): ReadonlyArray<StaffNote> {
  const ordered = [...spelling.tones].sort(([a], [b]) => a - b)
  const notes: Array<StaffNote> = ordered.map(([degree, semitones]) => toneNote(spelling, degree, semitones))
  const bass = bassNote(spelling)
  if (bass !== null) return [bass, ...notes]
  return notes
}

/** The note's height in letter steps from C0: one step per line or space of the staff. */
export function staffStep(note: StaffNote): number {
  return note.octave * 7 + indexOf(note.letter)
}

/**
 * Which side of the stem line each note sits on, bottom to top, for notes a
 * second apart. A note a step above the note below it takes the opposite side
 * from that note; a note that starts such a run takes "left"; any other note
 * is "center".
 */
export function staffSides(steps: ReadonlyArray<number>): ReadonlyArray<"left" | "right" | "center"> {
  const sides: Array<"left" | "right" | "center"> = []
  for (let i = 0; i < steps.length; i += 1) {
    if (i > 0 && steps[i]! - steps[i - 1]! === 1) {
      sides.push(sides[i - 1] === "left" ? "right" : "left")
    } else if (i + 1 < steps.length && steps[i + 1]! - steps[i]! === 1) {
      sides.push("left")
    } else {
      sides.push("center")
    }
  }
  return sides
}

function toneNote(spelling: Spelling, degree: number, semitones: number): StaffNote {
  const letter = letterAbove(spelling.rootLetter, degree - 1)
  const octave = 4 + Math.floor((indexOf(spelling.rootLetter) + (degree - 1)) / 7)
  const pitchClass = ((spelling.root + semitones) % 12 + 12) % 12
  return { letter, accidental: accidentalOf(pitchClass, letter), octave, degree }
}

function bassNote(spelling: Spelling): StaffNote | null {
  if (spelling.bass === spelling.root) return null
  const bassAccidental = accidentalOf(spelling.bass, spelling.bassLetter)
  const rootPitch = pitchOf(spelling.rootLetter, accidentalOf(spelling.root, spelling.rootLetter), 4)
  let octave = 4
  while (pitchOf(spelling.bassLetter, bassAccidental, octave) >= rootPitch) octave -= 1
  let degree: number | null = null
  for (const [candidate, semitones] of spelling.tones) {
    const pitchClass = ((spelling.root + semitones) % 12 + 12) % 12
    if (pitchClass === spelling.bass && (degree === null || candidate < degree)) degree = candidate
  }
  return { letter: spelling.bassLetter, accidental: bassAccidental, octave, degree }
}

const ORDER: ReadonlyArray<string> = ["C", "D", "E", "F", "G", "A", "B"]

function indexOf(letter: string): number {
  return ORDER.indexOf(letter)
}

function letterAbove(root: string, steps: number): string {
  return ORDER[(indexOf(root) + steps) % 7]!
}

function accidentalOf(pitchClass: number, letter: string): number {
  const diff = pitchClass - NATURALS[letter]!
  return ((((diff + 6) % 12) + 12) % 12) - 6
}

/** Absolute pitch: letter in its octave plus its accidental, C4 as 60. */
function pitchOf(letter: string, accidental: number, octave: number): number {
  return (octave + 1) * 12 + NATURALS[letter]! + accidental
}
