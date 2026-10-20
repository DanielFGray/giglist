/**
 * Writes src/charts/rock-prior.json, the corpus layer of the chord suggestions,
 * from both analysts' readings of every rs200 song.
 * Usage: bun scripts/buildRockPrior.ts <dir of rs200 expanded .txt files>
 */
import { corpusRuns, priorFrom, readCorpus } from "./rockCorpus"

const dir = process.argv[2]
if (!dir) throw new Error("usage: bun scripts/buildRockPrior.ts <rs200_harmony_exp dir>")
const prior = priorFrom(corpusRuns(readCorpus(dir)))
const source = "Counted from the rock corpus (rs200) by Trevor de Clercq and David Temperley, https://rockcorpus.midside.com, CC BY 4.0. Built by scripts/buildRockPrior.ts."
await Bun.write(new URL("../src/charts/rock-prior.json", import.meta.url), JSON.stringify({ source, ...prior }, null, 1) + "\n")
console.log(`classes: ${Object.keys(prior.unigram).length}`)
