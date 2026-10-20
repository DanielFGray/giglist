/**
 * Checks numeral()'s applied-chord rule against the rock corpus experts. For
 * each chord either the expert or the app calls applied (V/x, vii°/x), it counts
 * where they agree, and gives the two experts' agreement with each other as the
 * ceiling. Usage: bun scripts/checkNumerals.ts <dir of rs200 expanded .txt files>
 */
import { numeral } from "../src/charts/numeral"
import { readCorpus, type CorpusChord } from "./rockCorpus"

const dir = process.argv[2]
if (!dir) throw new Error("usage: bun scripts/checkNumerals.ts <rs200_harmony_exp dir>")

const songs = readCorpus(dir)
const expertApplied = (chord: CorpusChord) => /\/(?!I$|i$)/.test(chord.symbol)
const appApplied = (label: string | null) => label !== null && /\/[b#]?[IViv]/.test(label)

const tally = { both: 0, expertOnly: 0, appOnly: 0 }
const misses = new Map<string, number>()
for (const { chords } of songs) {
  chords.forEach((chord, index) => {
    const next = chords.slice(index + 1).find((later) => later.name !== chord.name && later.key === chord.key)
    const label = numeral(chord.name, chord.key, next?.name ?? null)
    const expert = expertApplied(chord)
    const app = appApplied(label)
    if (expert && app) tally.both += 1
    else if (expert) tally.expertOnly += 1
    else if (app) tally.appOnly += 1
    if (expert !== app) {
      const key = `${expert ? "expert" : "app"} only: ${chord.symbol} -> ${next?.symbol ?? "end"} (app: ${label})`
      misses.set(key, (misses.get(key) ?? 0) + 1)
    }
  })
}

// The experts share barlines, so their chord lists line up where both hear the same number of changes.
const experts = { both: 0, one: 0 }
const bySong = Map.groupBy(songs, (song) => song.song)
for (const [, pair] of bySong) {
  const [a, b] = pair
  if (!a || !b || a.chords.length !== b.chords.length) continue
  a.chords.forEach((chord, index) => {
    const x = expertApplied(chord)
    const y = expertApplied(b.chords[index]!)
    if (x && y) experts.both += 1
    else if (x || y) experts.one += 1
  })
}

const agreement = (both: number, disagree: number) => ((100 * both) / (both + disagree)).toFixed(1)
console.log(`analyses: ${songs.length}`)
console.log(`app vs expert, applied chords: both ${tally.both}, expert only ${tally.expertOnly}, app only ${tally.appOnly} -> ${agreement(tally.both, tally.expertOnly + tally.appOnly)}% agreement`)
console.log(`expert vs expert (songs with equal chord counts): both ${experts.both}, one ${experts.one} -> ${agreement(experts.both, experts.one)}% agreement`)
console.log("\nmost frequent disagreements:")
for (const [what, count] of [...misses].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(count).padStart(4)}  ${what}`)
