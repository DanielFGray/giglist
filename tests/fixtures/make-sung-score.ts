/**
 * Makes amazing-grace.gp, a Guitar Pro 7 score with lyrics on a vocal track and
 * unnamed triads on a guitar track, for the spec that reads chords over lyrics
 * from an uploaded score and works out its chords from the notes.
 *
 * Run it from the repository root: `bun tests/fixtures/make-sung-score.ts`.
 */
import { writeFileSync } from "node:fs"
import { exporter, importer, Settings } from "@coderline/alphatab"

const tex = [
  `\\title "Amazing Grace"`,
  `\\tempo 80`,
  `.`,
  `\\track "Vocals"`,
  `\\lyrics "A-ma-zing grace how sweet the sound"`,
  `r.4 0.3.4 0.3.4 0.3.4 | 0.3.2 0.3.2 | 0.3.2 0.3.2 | 0.3.1 |`,
  `\\track "Guitar"`,
  `(3.6 2.5 0.4 0.3 0.2 3.1).1 | (3.5 2.4 0.3 1.2 0.1).1 | (5.5 4.4 2.3 3.2 2.1).1 | (3.6 2.5 0.4 0.3 0.2 3.1).1 |`,
].join("\n")

const reader = new importer.AlphaTexImporter()
reader.initFromString(tex, new Settings())
const score = reader.readScore()
const bytes = new exporter.Gp7Exporter().export(score, new Settings())
writeFileSync(new URL("./amazing-grace.gp", import.meta.url), bytes)
console.log(`amazing-grace.gp: ${bytes.length} bytes, ${score.tracks.length} tracks`)
