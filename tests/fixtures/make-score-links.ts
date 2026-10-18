/**
 * Makes sections.gp, a Guitar Pro 7 score for the score-link specs: eight bars
 * of one guitar track, with section markers (Verse, Chorus, Verse 2), a repeat
 * from bar 3 to bar 5, and a tempo change in bar 2.
 *
 * Run it from the repository root: `bun tests/fixtures/make-score-links.ts`.
 * The file is written by alphaTab's own exporter, so regenerating it gives the
 * same bytes for the same alphaTex.
 */
import { writeFileSync } from "node:fs"
import { exporter, importer, Settings } from "@coderline/alphatab"

const bar = (extra: string) => `${extra} :4 3.2 3.2 3.2 3.2 |`

const tex = [
  `\\track ("Lead Gtr" "Lead Gtr")`,
  `\\staff {score tabs}`,
  `\\ks g \\ts 4 4 \\tempo 100`,
  bar('\\section "Verse" "Verse"'),
  bar("\\tempo 140"),
  bar("\\ro"),
  bar(""),
  bar("\\rc 2"),
  bar('\\section "Chorus" "Chorus"'),
  bar('\\section "Verse 2" "Verse 2"'),
  bar(""),
].join("\n")

const reader = new importer.AlphaTexImporter()
reader.initFromString(tex, new Settings())
const score = reader.readScore()
const bytes = new exporter.Gp7Exporter().export(score, new Settings())
writeFileSync(new URL("./sections.gp", import.meta.url), bytes)
console.log(`sections.gp: ${bytes.length} bytes, ${score.masterBars.length} bars`)
