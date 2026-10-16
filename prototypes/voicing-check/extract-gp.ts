/**
 * Reads every Guitar Pro file and writes the chord diagrams each one carries:
 * { source, name, frets } with frets lowest string first, null = not played.
 *
 * alphaTab's model.Chord.strings holds ABSOLUTE frets, highest string first,
 * -1 for a muted string. Proof in the report: the chord-diagram painter does
 * `fret -= firstFret - 1` before drawing (alphaTab.core.mjs:50822), and the
 * GPIF reader builds absolute frets as `baseFret + fret` (alphaTab.core.mjs:20108).
 */
import { alphaTab, type Chord } from "./vendor"

const { importer, Settings } = alphaTab

const DIR = "/home/dan/Guitar Pro Tabs"
/** Standard tuning as alphaTab reports it: highest string first. */
const STANDARD_HIGH_FIRST = [64, 59, 55, 50, 45, 40]

export type Reference = {
  readonly source: string
  readonly name: string
  readonly frets: ReadonlyArray<number | null>
  /** alphaTab's own base fret of the diagram, kept so the report can show it. */
  readonly firstFret: number
  readonly barreFrets: ReadonlyArray<number>
}

const files = [...new Bun.Glob("*.{gp,gp3,gp4,gp5,gpx}").scanSync({ cwd: DIR, onlyFiles: true })].sort()
const seen = new Set<string>()
const out: Array<Reference> = []
let staves = 0
let stavesWithChords = 0
let capoStaves = 0
let shapes = 0
const failures: Array<string> = []
/** Every diagram as alphaTab hands it over, for the report's fret-reading evidence. */
const raw: Array<{ source: string; name: string; firstFret: number; strings: number[]; barreFrets: number[] }> = []

for (const file of files) {
  let score: ReturnType<typeof importer.ScoreLoader.loadScoreFromBytes>
  try {
    score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await Bun.file(`${DIR}/${file}`).arrayBuffer()), new Settings())
  } catch (error) {
    failures.push(`${file}: ${(error as Error).message.split("\n")[0]}`)
    continue
  }
  for (const track of score.tracks)
    for (const stave of track.staves) {
      staves += 1
      const tuning = stave.tuning
      const chords = stave.chords ?? new Map<string, Chord>()
      if (chords.size === 0) continue
      // Only a six-string staff in standard tuning: our shapes are six strings.
      if (tuning.length !== 6 || tuning.some((p: number, i: number) => p !== STANDARD_HIGH_FIRST[i])) continue
      // A capo shifts what the shape sounds without changing the frets drawn, so
      // its notes no longer match a name spelled at concert pitch. Counted, not used.
      if ((stave.capo ?? 0) !== 0) {
        capoStaves += 1
        continue
      }
      stavesWithChords += 1
      for (const [, chord] of chords) {
        if (!chord.name || chord.strings.length !== 6) continue
        // Kept as alphaTab holds it, so the report can show the reading that
        // settles whether `strings` is absolute: a known chord either reads as
        // itself or does not.
        raw.push({ source: file, name: chord.name, firstFret: chord.firstFret, strings: chord.strings, barreFrets: chord.barreFrets ?? [] })
        // Highest string first -> lowest string first; -1 becomes null.
        const frets = [...chord.strings].reverse().map((fret: number) => (fret < 0 ? null : fret))
        const key = `${chord.name}\t${frets.map((f) => (f === null ? "x" : f)).join(" ")}`
        if (seen.has(key)) continue
        seen.add(key)
        shapes += 1
        out.push({ source: file, name: chord.name, frets, firstFret: chord.firstFret, barreFrets: chord.barreFrets ?? [] })
      }
    }
}

await Bun.write("gp.json", JSON.stringify(out, null, 1))
const stats = { files: files.length, readFailures: failures.length, staves, capoStaves, stavesWithChords, distinctShapes: shapes, failures, raw }
// compare.ts reads these counts for the report, so they go in a file.
await Bun.write("gp-stats.json", JSON.stringify(stats, null, 1))
console.log(
  JSON.stringify({ ...stats, raw: `${raw.length} diagrams kept raw in gp-stats.json` }, null, 1),
)
for (const f of failures) console.log("FAILED", f)
