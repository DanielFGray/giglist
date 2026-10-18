/**
 * The degree each note a guitar shape sounds is, as `R`, `3`, `b7` and so on.
 * Pure and free of the DOM, so the diagram and the tests share it.
 */
import type { PitchClass, Spelling } from "./spelling"
import type { Voicing } from "./fretting"
import { STANDARD_TUNING } from "./voicing"

/**
 * One label per string of `voicing`, in the same order. An open string counts as
 * sounding: it gets a label like any other. The label is null where the string
 * is muted, or sounds a pitch the chord does not name.
 *
 * The name is the chord's own degree number with `b` or `#` for how far it sits
 * from the major scale: `3` a major 3rd above the root, `b3` a minor one, `b7`
 * a minor 7th, `#11` a raised 11th. Two tones on one pitch class keep the
 * lower degree's name, so a sus 4th reads `4` and not `11`.
 */
export function degrees(
  chord: Spelling,
  voicing: Voicing,
  tuning: ReadonlyArray<number> = STANDARD_TUNING,
): ReadonlyArray<string | null> {
  const names = nameTones(chord)
  return voicing.frets.map((fret, string) => {
    const open = tuning[string]
    if (fret === null || open === undefined) return null
    return names.get(pitchClassOf(open + fret)) ?? null
  })
}

/** Each pitch class the chord names, under the degree name it earns. */
function nameTones(chord: Spelling): ReadonlyMap<PitchClass, string> {
  const names = new Map<PitchClass, string>()
  const tones = [...chord.tones].sort(([a], [b]) => a - b)
  for (const [degree, semitones] of tones) {
    const pitchClass = pitchClassOf(chord.root + semitones)
    if (!names.has(pitchClass)) names.set(pitchClass, nameOf(degree, semitones))
  }
  return names
}

function nameOf(degree: number, semitones: number): string {
  if (degree === 1) return "R"
  const plain = MAJOR[degree]
  if (plain === undefined) return String(degree)
  if (semitones < plain) return `b${degree}`
  if (semitones > plain) return `#${degree}`
  return String(degree)
}

/** Semitones above the root of each degree of the major scale. A 6th is a 13th. */
const MAJOR: Readonly<Record<number, number>> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 2, 11: 5, 13: 9 }

function pitchClassOf(pitch: number): PitchClass {
  return ((pitch % 12) + 12) % 12
}
