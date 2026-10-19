/**
 * Makes titled.gp, a Guitar Pro 7 score that names its title, artist and tempo,
 * for the spec that fills an untitled song from an uploaded score.
 *
 * Run it from the repository root: `bun tests/fixtures/make-titled-score.ts`.
 */
import { writeFileSync } from "node:fs"
import { exporter, importer, Settings } from "@coderline/alphatab"

const tex = [
  `\\title "Blackbird"`,
  `\\artist "The Beatles"`,
  `\\tempo 94`,
  `.`,
  `\\track ("Guitar" "Gtr")`,
  `\\staff {score tabs}`,
  `:4 3.2 3.2 3.2 3.2 | 3.2 3.2 3.2 3.2 |`,
].join("\n")

const reader = new importer.AlphaTexImporter()
reader.initFromString(tex, new Settings())
const score = reader.readScore()
const bytes = new exporter.Gp7Exporter().export(score, new Settings())
writeFileSync(new URL("./titled.gp", import.meta.url), bytes)
console.log(`titled.gp: ${bytes.length} bytes, "${score.title}" by ${score.artist} at ${score.tempo}`)
