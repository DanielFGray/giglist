/**
 * Measures the chord suggestions on the rock corpus by leaving one chord out:
 * for each chord change in a song, hide the chord, rank the classes, and count
 * how often the hidden chord's class is first, or in the first three.
 *
 * The corpus layer is counted without the song's own fold (5 folds by song), so
 * a song never suggests itself. Two settings: "between" knows the whole song but
 * the hidden chord (adding a chord to a finished chart); "writing" knows only
 * the chords before it (writing a chart from the top). Baselines: the editor's
 * palette (the key's chords in scale order, then the song's),
 * and the song's most used chords. "new chord" is the writing setting cut to
 * the chords the song has not used yet, where the song's own counts cannot help.
 *
 * Usage: bun scripts/checkSuggestions.ts <dir of rs200 expanded .txt files> [--fit]
 */
import { suggestedChords } from "../src/charts/lyrics"
import { keyScale } from "../src/charts/numeral"
import { changes, chordClass, rankClasses, WEIGHTS, type Prior } from "../src/charts/suggest"
import { corpusRuns, priorFrom, readCorpus } from "./rockCorpus"

const dir = process.argv[2]
if (!dir) throw new Error("usage: bun scripts/checkSuggestions.ts <rs200_harmony_exp dir> [--fit]")

const FOLDS = 5
const runs = corpusRuns(readCorpus(dir))
const songs = [...new Set(runs.map((run) => run.song))]
const foldOf = (song: string) => songs.indexOf(song) % FOLDS
const priors: ReadonlyArray<Prior> = Array.from({ length: FOLDS }, (_, fold) => priorFrom(runs.filter((run) => foldOf(run.song) !== fold)))

/** One hidden chord: the classes before and after it, and the class to find. */
type Case = { fold: number; key: string; before: ReadonlyArray<string>; after: ReadonlyArray<string>; hidden: string; names: ReadonlyArray<string> }

// One analyst's reading per song, so a song is not counted twice.
const tested = runs.filter((run) => run.analyst === "dt")

const cases = (setting: "between" | "writing"): ReadonlyArray<Case> =>
  tested.flatMap((run) => {
    const scale = keyScale(run.key)!
    const classes = changes(run.chords.flatMap((chord) => chordClass(chord, scale) ?? []))
    return classes.flatMap((hidden, index) => {
      if (index === 0) return []
      const before = classes.slice(0, index)
      const after = setting === "between" ? classes.slice(index + 1) : []
      const known = setting === "between" ? [...run.chords.slice(0, index), ...run.chords.slice(index + 1)] : run.chords.slice(0, index)
      return [{ fold: foldOf(run.song), key: run.key, before, after, hidden, names: known }]
    })
  })

/** Share of cases whose hidden class is in the first `k` of `rank`. */
function score(all: ReadonlyArray<Case>, rank: (item: Case) => ReadonlyArray<string>): { top1: number; top3: number } {
  let top1 = 0
  let top3 = 0
  for (const item of all) {
    const ranked = rank(item)
    if (ranked[0] === item.hidden) top1 += 1
    if (ranked.slice(0, 3).includes(item.hidden)) top3 += 1
  }
  return { top1: top1 / all.length, top3: top3 / all.length }
}

const unique = (classes: ReadonlyArray<string | null>) => [...new Set(classes.filter((cls): cls is string => cls !== null))]
const palette = (item: Case) => {
  const scale = keyScale(item.key)!
  return unique([...suggestedChords(item.key), ...item.names].map((chord) => chordClass(chord, scale)))
}
const mostUsed = (item: Case) => {
  const counts = new Map<string, number>()
  for (const cls of [...item.before, ...item.after]) counts.set(cls, (counts.get(cls) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([cls]) => cls)
}
const model = (weights: typeof WEIGHTS) => (item: Case) => rankClasses(item.before, item.after, priors[item.fold]!, weights)

const percent = (value: number) => `${(100 * value).toFixed(1)}%`.padStart(6)
const settings = { between: cases("between"), writing: cases("writing") }
const fresh = settings.writing.filter((item) => !item.before.includes(item.hidden))
for (const [setting, all] of [...Object.entries(settings), ["new chord", fresh] as const]) {
  console.log(`\n${setting}: ${all.length} hidden chords`)
  for (const [name, rank] of [
    ["editor palette", palette],
    ["most used in the song", mostUsed],
    // Pseudo-counts this large drown the song's counts, leaving the corpus layer.
    ["corpus only (no song layer)", model({ song: 1e9, corpus: WEIGHTS.corpus, trigram: 1e9 })],
    ["model", model(WEIGHTS)],
    ["model, new to the song only", (item: Case) => model(WEIGHTS)(item).filter((cls) => !item.before.includes(cls) && !item.after.includes(cls))],
  ] as const) {
    const { top1, top3 } = score(all, rank)
    console.log(`  ${name.padEnd(30)} top-1 ${percent(top1)}  top-3 ${percent(top3)}`)
  }
}

if (process.argv.includes("--fit")) {
  // A small grid over the three pseudo-counts, scored on both settings at once.
  const all = [...settings.between, ...settings.writing]
  const fits: Array<[string, number]> = []
  for (const song of [0.5, 1, 2, 4, 8])
    for (const corpus of [1, 4, 16, 64])
      for (const trigram of [0.25, 1, 4])
        fits.push([JSON.stringify({ song, corpus, trigram }), score(all, model({ song, corpus, trigram })).top3])
  console.log("\nbest weights by top-3 over both settings:")
  for (const [weights, top3] of fits.sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  ${weights} ${percent(top3)}`)
}
