import { spell, type Spelling } from "./spelling"

/** Which of a chord's two names a chart shows: the name, the numeral, or both. */
export type NumeralDisplay = "names" | "numerals" | "both"

/** Maps a semitone offset from the tonic to its Roman numeral degree. */
const DEGREE_NAME: ReadonlyArray<string> = [
  "I", // 0
  "bII", // 1
  "II", // 2
  "bIII", // 3
  "III", // 4
  "IV", // 5
  "#IV", // 6
  "V", // 7
  "bVI", // 8
  "VI", // 9
  "bVII", // 10
  "VII", // 11
]

/**
 * Returns the Roman numeral for `chord` in the context of `key`.
 * Returns null when the key is null, the chord cannot be spelled, or the key is invalid.
 *
 * The chord is already in the shown key (renderLyrics moves it), so the numeral
 * is computed against that key. The suffix follows the root and is kept verbatim,
 * with a leading minor marker ("m" or "min") removed. The slash bass is dropped.
 * Case shows quality: lowercase when the chord has a minor third.
 */
export function numeral(chord: string, key: string | null): string | null {
  if (key === null) return null

  const spelling = spell(chord)
  if (spelling === null) return null

  const tonic = keyTonic(key)
  if (tonic === null) return null

  const degree = (spelling.root - tonic + 12) % 12
  const hasMinorThird = hasMinorThirdInSpelling(spelling)
  const baseNumeral = DEGREE_NAME[degree]
  const casedNumeral = hasMinorThird ? baseNumeral.toLowerCase() : baseNumeral
  const suffix = chordSuffix(chord)

  return casedNumeral + suffix
}

/** Extracts the tonic pitch class from a key string (e.g., "C", "Gm", "F#m"). */
function keyTonic(key: string): number | null {
  const minor = key.endsWith("m")
  const tonicName = minor ? key.slice(0, -1) : key
  const spelling = spell(tonicName)
  return spelling?.root ?? null
}

/** Checks if the spelling contains a minor third (root + 3 semitones). */
function hasMinorThirdInSpelling(spelling: Spelling): boolean {
  const minorThirdPitch = (spelling.root + 3) % 12
  return spelling.required.includes(minorThirdPitch) || spelling.optional.includes(minorThirdPitch)
}

/** Extracts the suffix from a chord name, removing a leading minor marker. */
function chordSuffix(chord: string): string {
  const rootEnd = findRootEnd(chord)
  if (rootEnd === null) return ""
  // Drop slash bass first
  const slashIndex = chord.indexOf("/", rootEnd)
  const suffixEnd = slashIndex >= 0 ? slashIndex : chord.length
  let suffix = chord.slice(rootEnd, suffixEnd)

  // Remove leading minor marker: "m", "min" (but not "maj", "ma", "M", etc.)
  // The minor marker must be at the start of the suffix and not followed by "a" or "j" (for "maj", "ma")
  if (suffix.startsWith("min")) {
    suffix = suffix.slice(3)
  } else if (suffix.startsWith("m") && !suffix.startsWith("ma") && !suffix.startsWith("M") && !suffix.startsWith("j")) {
    suffix = suffix.slice(1)
  }
  return suffix
}

/** Finds the end index of the root note in a chord name. */
function findRootEnd(chord: string): number | null {
  // Root is a note letter A-G optionally followed by accidentals (#, b, ♯, ♭)
  const match = chord.match(/^[A-G][#b♯♭]*/)
  return match ? match[0].length : null
}