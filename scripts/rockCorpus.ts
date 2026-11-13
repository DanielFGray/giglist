/**
 * Reads the expanded harmonic analyses of the rock corpus (rs200, by Trevor de
 * Clercq and David Temperley, CC BY 4.0, https://rockcorpus.midside.com) into
 * chord names, so the app's own numeral and suggestion code can be checked
 * against two experts' analyses. Each song has two files, one per analyst
 * (`_dt`, `_tdc`); both share their barlines.
 *
 * Download `harmonic_analyses/rs200_harmony_exp.zip` from the site, unzip it,
 * and pass the directory that holds the `.txt` files.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { keyScale } from "alphatab-kit/charts/numeral"
import { chordClass, type Prior } from "../src/charts/suggest"

/** One chord of an analysis: the expert's numeral, and the chord it names in the song's key. */
export type CorpusChord = {
  /** The analyst's symbol, as written: `V65/vi`. */
  readonly symbol: string
  /** The chord as a name: `E7/G#`. */
  readonly name: string
  /** The key in force, as the app writes keys: `C`, `Am`. */
  readonly key: string
}

export type CorpusSong = { readonly song: string; readonly analyst: "dt" | "tdc"; readonly chords: ReadonlyArray<CorpusChord> }

/** Every analysis in `dir`, with its chords in order. A held chord (`.`) is not repeated. */
export function readCorpus(dir: string): ReadonlyArray<CorpusSong> {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".txt"))
    .sort()
    .map((file) => {
      const [, song, analyst] = file.match(/^(.*)_(dt|tdc)\.txt$/)!
      return { song: song!, analyst: analyst as "dt" | "tdc", chords: readAnalysis(readFileSync(join(dir, file), "utf8")) }
    })
}

/** Note names by pitch class, flats for the black keys. */
const NOTE = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const ROMAN: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 }

function readAnalysis(text: string): ReadonlyArray<CorpusChord> {
  const tokens = text.split(/\s+/).filter((token) => token !== "" && token !== "|" && token !== ".")
  // A key symbol says only the tonic; the mode of each stretch is read from its tonic chords.
  const stretches: Array<{ tonic: number; symbols: Array<string> }> = []
  for (const token of tokens) {
    const keySymbol = token.match(/^\[([A-G][#b]?)\]$/)
    if (keySymbol) stretches.push({ tonic: pitchOf(keySymbol[1]!), symbols: [] })
    else if (!token.startsWith("[")) stretches.at(-1)?.symbols.push(token)
  }
  return stretches.flatMap(({ tonic, symbols }) => {
    const minors = symbols.filter((symbol) => /^i(?![iv])/.test(symbol)).length
    const majors = symbols.filter((symbol) => /^I(?![IV])/.test(symbol)).length
    const key = NOTE[tonic]! + (minors > majors ? "m" : "")
    return symbols.flatMap((symbol) => {
      const name = chordName(symbol, tonic)
      return name === null ? [] : [{ symbol, name, key }]
    })
  })
}

function pitchOf(note: string): number {
  return (NATURAL[note[0]!]! + (note[1] === "#" ? 1 : note[1] === "b" ? -1 : 0) + 12) % 12
}

/** A numeral's root above the tonic: `bVII` is 10. Null for anything else, such as `R` (rest). */
function degreeOf(numeral: string): { semitones: number; minor: boolean; length: number } | null {
  const found = numeral.match(/^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)/)
  if (found === null) return null
  const shift = found[1] === "b" ? -1 : found[1] === "#" ? 1 : 0
  return { semitones: (ROMAN[found[2]!.toUpperCase()]! + shift + 12) % 12, minor: found[2] !== found[2]!.toUpperCase(), length: found[0].length }
}

/**
 * The chord an analyst's symbol names, with the tonic at `tonic`. Lowercase is
 * minor, `o` diminished, `a` augmented, `h7` half-diminished, `x7` diminished 7th,
 * `d7` dominant 7th; `7` on an uppercase numeral is a major 7th except on V;
 * 6, 64, 65, 43 and 42 are inversions; `s4` is a sus 4th.
 */
function chordName(symbol: string, tonic: number): string | null {
  const [own, applied] = symbol.split("/")
  const degree = degreeOf(own!)
  if (degree === null) return null
  const target = applied === undefined ? null : degreeOf(applied)
  const root = (tonic + degree.semitones + (target?.semitones ?? 0)) % 12
  const rest = own!.slice(degree.length)

  const inversionFigure = rest.match(/(65|43|42|64|6)$/)?.[1]
  const sevenths = /7|9|13|65|43|42/.test(rest)
  let suffix: string
  let third = degree.minor ? 3 : 4
  let fifth = 7
  let seventh = 0
  if (rest.includes("x")) [suffix, third, fifth, seventh] = sevenths ? ["dim7", 3, 6, 9] : ["dim", 3, 6, 0]
  else if (rest.includes("h")) [suffix, third, fifth, seventh] = ["m7b5", 3, 6, 10]
  else if (rest.includes("o")) [suffix, third, fifth, seventh] = sevenths ? ["dim7", 3, 6, 9] : ["dim", 3, 6, 0]
  else if (rest.startsWith("a")) [suffix, fifth] = ["aug", 8]
  else if (rest.includes("s4")) [suffix, third] = [sevenths ? "7sus4" : "sus4", 5]
  else if (!sevenths) suffix = degree.minor ? "m" : ""
  else if (degree.minor) [suffix, seventh] = ["m7", 10]
  else if (rest.includes("d") || own!.startsWith("V") || target !== null) [suffix, seventh] = ["7", 10]
  else [suffix, seventh] = ["maj7", 11]
  if (seventh === 0 && sevenths) seventh = 10

  const bassAbove = inversionFigure === "6" || inversionFigure === "65" ? third : inversionFigure === "64" || inversionFigure === "43" ? fifth : inversionFigure === "42" ? seventh : 0
  const name = NOTE[root]! + suffix
  return bassAbove === 0 ? name : `${name}/${NOTE[(root + bassAbove) % 12]}`
}

export type CorpusRun = { readonly song: string; readonly analyst: CorpusSong["analyst"]; readonly key: string; readonly chords: ReadonlyArray<string> }

/**
 * The analyses as runs of chord names, one run per stretch in one key, with a
 * chord held over a barline counted once.
 */
export function corpusRuns(songs: ReadonlyArray<CorpusSong>): ReadonlyArray<CorpusRun> {
  return songs.flatMap(({ song, analyst, chords }) => {
    const runs: Array<CorpusRun & { chords: Array<string> }> = []
    for (const chord of chords) {
      const run = runs.at(-1)
      if (run === undefined || run.key !== chord.key) runs.push({ song, analyst, key: chord.key, chords: [chord.name] })
      else if (run.chords.at(-1) !== chord.name) run.chords.push(chord.name)
    }
    return runs
  })
}

/** Counts chord changes by class over `runs`: the corpus layer of the suggestion model. */
export function priorFrom(runs: ReadonlyArray<{ key: string; chords: ReadonlyArray<string> }>): Prior {
  const unigram: Record<string, number> = {}
  const bigram: Record<string, Record<string, number>> = {}
  for (const { key, chords } of runs) {
    const scale = keyScale(key)!
    const classes = chords.flatMap((chord) => chordClass(chord, scale) ?? [])
    classes.forEach((cls, index) => {
      unigram[cls] = (unigram[cls] ?? 0) + 1
      const previous = classes[index - 1]
      if (previous === undefined || previous === cls) return
      const row = (bigram[previous] ??= {})
      row[cls] = (row[cls] ?? 0) + 1
    })
  }
  return { unigram, bigram }
}
