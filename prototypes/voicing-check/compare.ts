/**
 * Compares the reference chord shapes against what voicings(spell(name)) gives.
 * Writes report.md.
 *
 * Rules checked for a reference shape, from src/charts/voicing.ts:
 *   - every required note sounds, and no note outside the chord sounds
 *   - the lowest-sounding pitch is the chord's bass
 *   - at least 3 strings sound (2 for a power chord)
 *   - fretted notes lie within 4 frets, so the span is 3 or less
 *   - fingersNeeded(frets) <= 4
 */
import { spell, type Spelling } from "/home/dan/build/setlist/src/charts/spelling"
import { voicings, STANDARD_TUNING } from "/home/dan/build/setlist/src/charts/voicing"
import { fingersNeeded, writeFrets } from "/home/dan/build/setlist/src/charts/fretting"

type Shape = { readonly name: string; readonly frets: ReadonlyArray<number | null>; readonly source?: string }

const gp = (await Bun.file("gp.json").json()) as Array<Shape & { source: string }>
const csjs = (await Bun.file("csjs.json").json()) as Array<Shape & { reading: string }>
const gpStats = (await Bun.file("gp-stats.json").json()) as {
  files: number
  readFailures: number
  staves: number
  capoStaves: number
  stavesWithChords: number
  distinctShapes: number
  failures: Array<string>
  raw: Array<{ source: string; name: string; firstFret: number; strings: number[]; barreFrets: number[] }>
}
const csjsStats = (await Bun.file("csjs-stats.json").json()) as {
  tableEntries: number
  readings: Record<string, number>
  noReadingCount: number
  noReading: Array<{ name: string; text: string; base: number }>
  unreadableCount: number
}

/** The file whose diagrams are quoted to show how `strings` reads. */
const EVIDENCE_SOURCE = "Carry On My Wayward Son.gp5"
const EVIDENCE_NAMES = ["A5", "Dm", "C/G", "F6"]
const evidence = gpStats.raw
  .filter((entry) => entry.source === EVIDENCE_SOURCE && EVIDENCE_NAMES.includes(entry.name))
  .filter((entry, i, all) => all.findIndex((other) => other.name === entry.name) === i)
  .map((entry) => ({
    name: entry.name,
    source: entry.source,
    firstFret: entry.firstFret,
    strings: entry.strings,
    reads: writeFrets([...entry.strings].reverse().map((fret) => (fret < 0 ? null : fret)) as Array<number | null>),
  }))

/** Why a shape is not one our rules accept, or null when it is. */
function brokenRule(frets: ReadonlyArray<number | null>, chord: Spelling): string | null {
  const isPower = chord.optional.length === 0 && chord.required.length === 2
  const sounding = frets.flatMap((fret, i) => (fret === null ? [] : [i]))
  if (sounding.length < (isPower ? 2 : 3)) return `only ${sounding.length} strings sound`
  const pitches = sounding.map((i) => STANDARD_TUNING[i]! + frets[i]!)
  const pcs = new Set(pitches.map((p) => p % 12))
  const allowed = new Set([...chord.required, ...chord.optional])
  const outside = [...pcs].filter((pc) => !allowed.has(pc))
  if (outside.length > 0) return `outside note ${outside.join(",")}`
  const missing = chord.required.filter((pc) => !pcs.has(pc))
  if (missing.length > 0) return `missing note ${missing.join(",")}`
  if ((Math.min(...pitches) % 12) !== chord.bass) return `bass is ${Math.min(...pitches) % 12}, not ${chord.bass}`
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0)
  if (fretted.length > 0 && Math.max(...fretted) - Math.min(...fretted) > 3) return `span ${Math.max(...fretted) - Math.min(...fretted)} > 3`
  const fingers = fingersNeeded([...frets] as Array<number | null>)
  if (fingers > 4) return `${fingers} fingers > 4`
  return null
}

type Miss = {
  readonly reference: string
  readonly name: string
  readonly shape: string
  readonly ours: string
  readonly why: string
}

type Stats = {
  label: string
  total: number
  unreadable: number
  unreadableNames: Map<string, number>
  playable: number
  inList: number
  inTop3: number
  rules: Map<string, number>
  misses: Array<Miss>
}

function measure(label: string, shapes: ReadonlyArray<Shape>): Stats {
  const unreadableNames = new Map<string, number>()
  const rules = new Map<string, number>()
  const misses: Array<Miss> = []
  let unreadable = 0
  let playable = 0
  let inList = 0
  let inTop3 = 0

  const oursCache = new Map<string, Array<string>>()
  for (const { name, frets } of shapes) {
    const chord = spell(name)
    if (chord === null) {
      unreadable += 1
      unreadableNames.set(name, (unreadableNames.get(name) ?? 0) + 1)
      continue
    }
    const failure = brokenRule(frets, chord)
    if (failure !== null) {
      rules.set(failure.replace(/-?\d+/g, "n"), (rules.get(failure.replace(/-?\d+/g, "n")) ?? 0) + 1)
      continue
    }
    playable += 1
    let ours = oursCache.get(name)
    if (ours === undefined) {
      ours = voicings(chord).map((shape) => writeFrets(shape.frets))
      oursCache.set(name, ours)
    }
    const key = writeFrets([...frets] as Array<number | null>)
    const at = ours.indexOf(key)
    if (at < 0) {
      misses.push({ reference: label, name, shape: key, // Comma-joined, not pipe-joined: this text goes in a markdown table cell.
ours: ours.slice(0, 3).map((shape) => `\`${shape}\``).join(", "), why: whyMissed(frets, ours) })
    } else {
      inList += 1
      if (at < 3) inTop3 += 1
    }
  }
  return { label, total: shapes.length, unreadable, unreadableNames, playable, inList, inTop3, rules, misses }
}

/**
 * Why the shape is absent. Our generator finds every playable shape, then keeps
 * at most 8 of them, dropping one that a shape kept before it already covers by
 * leaving strings out (voicing.ts:31). The rules that decide playability already
 * passed, so only the dedupe and the rank cap can drop it.
 *
 * Which of the two happened is not always knowable from outside: the generator
 * does not report the rank of a shape it dropped. A shape our best one covers
 * was certainly dropped, since nothing outranks our best. A shape only a later
 * one of ours covers was probably dropped. The reason says which.
 */
function whyMissed(frets: ReadonlyArray<number | null>, ours: ReadonlyArray<string>): string {
  const highest = Math.max(0, ...frets.filter((fret): fret is number => fret !== null))
  if (highest > 15) return `a fret of ${highest} is past our neck`
  const covers = (better: string) =>
    frets.every((fret, i) => fret === null || fret === Number(better.split(" ")[i]))
  const at = ours.findIndex(covers)
  if (at === 0) return "our best shape covers it with strings left out"
  if (at > 0) return `our #${at + 1} shape probably covers it with strings left out`
  return "ranked 9th or lower, past our top 8"
}

const results = [measure("Guitar Pro", gp), measure("ChordSheetJS", csjs)]
const gpStatsMeasured = results[0]!
const csjsStatsMeasured = results[1]!
const gpPlayable = gpStatsMeasured.playable
const csjsPlayable = csjsStatsMeasured.playable
/** How many ChordSheetJS shapes our four-finger rule turns away. */
const csjsFinger = csjsStatsMeasured.rules.get("n fingers > n") ?? 0

/** The 30 most frequent names spell() cannot read, over both references. */
const unreadable = new Map<string, number>()
for (const stats of results)
  for (const [name, count] of stats.unreadableNames) unreadable.set(name, (unreadable.get(name) ?? 0) + count)

const percent = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`)

const lines: Array<string> = []
lines.push("# Do our generated shapes match real chord diagrams?")
lines.push("")
lines.push("`voicings(spell(name))` from `src/charts/voicing.ts` against two references: the chord diagrams in")
lines.push("`/home/dan/Guitar Pro Tabs` read with alphaTab, and ChordSheetJS 18's own 902-entry guitar chord table.")
lines.push("Two references, one question: does the generator give the shapes guitarists actually use?")
lines.push("")
lines.push("## Headline")
lines.push("")
lines.push("| Reference | Shapes | `spell` reads | Playable by our rules | In `voicings(...)` | In our top 3 |")
lines.push("| --- | --- | --- | --- | --- | --- |")
for (const s of results)
  lines.push(
    `| ${s.label} | ${s.total} | ${s.total - s.unreadable} (${percent(s.total - s.unreadable, s.total)}) | ${s.playable} | ${percent(s.inList, s.playable)} | ${percent(s.inTop3, s.playable)} |`,
  )
lines.push("")
for (const s of results) {
  lines.push(`### ${s.label}`)
  lines.push("")
  lines.push(`- Shapes read: ${s.total}. Names \`spell\` could not read: ${s.unreadable}.`)
  lines.push(`- Shapes that satisfy our playability rules: ${s.playable}. The other ${s.total - s.unreadable - s.playable} are disagreements to judge, not failures.`)
  lines.push(`- Of those ${s.playable}: ${s.inList} appear in \`voicings(...)\` (${percent(s.inList, s.playable)}), ${s.inTop3} in the top 3 (${percent(s.inTop3, s.playable)}).`)
  lines.push("")
  lines.push("Why the rest failed our rules:")
  lines.push("")
  if (s.rules.size === 0) lines.push("- none")
  for (const [rule, count] of [...s.rules].sort((a, b) => b[1] - a[1])) lines.push(`- \`${rule}\`: ${count}`)
  lines.push("")
}

lines.push("## What the numbers say")
lines.push("")
lines.push("1. The rules are not what costs us shapes. Of the playable reference shapes, most of the loss comes after")
lines.push("   playability: our eight-shape cap and the dedupe that drops a shape a better one covers. The playability")
lines.push("   rules themselves exclude shapes mostly through one rule, four fingers.")
lines.push("2. The four-finger rule is the single biggest disagreement with the references.")
lines.push(`   ChordSheetJS prints ${csjsFinger} shapes that \`fingersNeeded\` puts over four. Guitar Pro prints none.`)
lines.push("   The mechanism is where a barre is allowed to sit: `barreOf` only builds one at the lowest fret of the")
lines.push("   shape, and only when two strings share it, so a shape whose lowest fret is a single string gets no barre")
lines.push("   credit and every other fretted string costs a finger. ChordSheetJS's `x 4 3 4 4 4` (C#9) is the plain")
lines.push("   case: five fretted notes, one at fret 3, four at fret 4. These are judgements, not failures, and the brief")
lines.push("   calls this a disagreement to judge, so this report states it and does not change the rule.")
lines.push(
  `3. The Guitar Pro rate rests on ${gpPlayable} playable shapes, which is too few to plan from. ChordSheetJS's ${csjsPlayable} is the number with weight behind it. A better Guitar Pro sample would need files that carry diagrams: ${gpStats.stavesWithChords} of the ${gpStats.staves} staves in the folder have any at all.`,
)
lines.push("")
lines.push("## How each reference was read")
lines.push("")
lines.push("### Guitar Pro")
lines.push("")
lines.push(`alphaTab 1.8.4 read ${gpStats.files} files (${gpStats.files - gpStats.readFailures} read, ${gpStats.readFailures} failed):`)
for (const failure of gpStats.failures) lines.push(`- \`${failure}\``)
lines.push("")
lines.push(`Those files hold ${gpStats.staves} staves. ${gpStats.stavesWithChords} staves in standard tuning carry chord diagrams;`)
lines.push(`${gpStats.capoStaves} more were skipped for a capo, since a capo shifts what a shape sounds without changing the frets`)
lines.push(`drawn. The staves kept hold ${gpStats.distinctShapes} distinct (name, shape) pairs.`)
lines.push("")
lines.push("**`model.Chord.strings` holds absolute frets, not frets relative to `firstFret`.** Three pieces of evidence:")
lines.push("")
lines.push("- The chord-diagram painter subtracts before it draws: `fret -= this._chord.firstFret - 1` (alphaTab.core.mjs:50822).")
lines.push("  That subtraction is only needed when the stored fret is absolute.")
lines.push("- The GPIF reader (GP7 `.gpx`) builds absolute frets itself: `chord.strings[...] = baseFret + fret` (alphaTab.core.mjs:20108).")
lines.push("- Known chords read correctly as absolute:")
lines.push("")
lines.push("  | Name | Source | `firstFret` | `strings` (highest first) | Reads as |")
lines.push("  | --- | --- | --- | --- | --- |")
for (const sample of evidence) lines.push(`  | \`${sample.name}\` | \`${sample.source}\` | ${sample.firstFret} | \`${sample.strings.join(",")}\` | \`${sample.reads}\` |`)
lines.push("")
lines.push("`A5` is the one that settles it: `firstFret` is 5 and the frets are 5 and 7, the A-shape power chord at the")
lines.push("5th fret. Read as relative to `firstFret` the shape would sit at fret 5 of an A5 at the nut, which is not a")
lines.push("chord. `Dm` reads as the open `x x 0 2 3 1` and `F6` as the standard barre at the 1st fret.")
lines.push("")
lines.push("alphaTab reports the highest string first, so every shape was reversed into our lowest-string-first order with -1")
lines.push("as `null`. Each (name, shape) pair counts once across the whole folder.")
lines.push("")
lines.push("### ChordSheetJS")
lines.push("")
lines.push(`The table holds ${csjsStats.tableEntries} entries. Each entry's \`base-fret\` is read both ways, plus the fret taken as`)
lines.push("absolute when `base-fret` is 0 or 1, and the reading whose sounded notes fit the name's own spelling wins.")
lines.push("")
lines.push("| Reading | Entries |")
lines.push("| --- | --- |")
lines.push(`| fret as absolute (\`base-fret\` 0 or 1) | ${csjsStats.readings.absolute} |`)
lines.push(`| absolute = pos + base - 1 | ${csjsStats.readings["pos+base-1"]} |`)
lines.push(`| absolute = pos + base | ${csjsStats.readings["pos+base"]} |`)
lines.push(`| no reading fit | ${csjsStats.noReadingCount} |`)
lines.push("")
lines.push("Both readings the brief names hold up. `A11` (base 2, frets `4 3 x 1 2 2`) is right as pos + base - 1, giving the")
lines.push("standard `5 4 x 2 3 3`. `A13(b9)` (base 3, frets `2 x 2 3 4 3`) is right as pos + base, giving `5 x 5 6 7 6`.")
lines.push(`The ${csjsStats.noReadingCount} entries with no fitting reading hold notes outside their name under every reading, so they`)
lines.push("are left out rather than guessed at. A sample:")
lines.push("")
lines.push("| Name | Table frets | base-fret |")
lines.push("| --- | --- | --- |")
for (const entry of csjsStats.noReading.slice(0, 15)) lines.push(`| \`${entry.name}\` | \`${entry.text}\` | ${entry.base} |`)
lines.push("")
lines.push("## Names `spell` cannot read")
lines.push("")
lines.push(`Total across both references: ${[...unreadable.values()].reduce((a, b) => a + b, 0)}.`)
lines.push("")
if (unreadable.size === 0) lines.push("None.")
else {
  lines.push("| Name | Times seen |")
  lines.push("| --- | --- |")
  for (const [name, count] of [...unreadable].sort((a, b) => b[1] - a[1]).slice(0, 30)) lines.push(`| \`${name}\` | ${count} |`)
}
lines.push("")

lines.push("## Misses")
lines.push("")
lines.push("Reference shapes that satisfy every playability rule but do not appear in `voicings(...)`.")
lines.push("")
lines.push("A shape that passed every playability rule can still be absent, for two reasons our generator gives us:")
lines.push("it keeps at most eight shapes per name (`kept.length === 8`, voicing.ts:33), and it drops a shape that one")
lines.push("already kept covers by leaving strings out (voicing.ts:31). Which of the two applies is not always knowable")
lines.push("from outside, because the generator does not report the rank of a shape it dropped. A shape our best one")
lines.push("covers was certainly dropped, since nothing outranks our best; a shape only a later one of ours covers was")
lines.push("probably dropped. The reason column says which. A fret past 15 would be a third reason, and no reference shape")
lines.push("has one.")
lines.push("")
const allMisses = results.flatMap((s) => s.misses)
const whyCounts = new Map<string, number>()
for (const miss of allMisses) whyCounts.set(miss.why, (whyCounts.get(miss.why) ?? 0) + 1)
lines.push("Miss reasons across both references:")
lines.push("")
for (const [why, count] of [...whyCounts].sort((a, b) => b[1] - a[1])) lines.push(`- \`${why}\`: ${count}`)
lines.push("")
lines.push("| Reference | Name | Reference shape | Our top 3 | Why missed |")
lines.push("| --- | --- | --- | --- | --- |")
for (const miss of allMisses.slice(0, 40)) lines.push(`| ${miss.reference} | \`${miss.name}\` | \`${miss.shape}\` | ${miss.ours} | ${miss.why} |`)
lines.push("")
lines.push("## Rerun")
lines.push("")
lines.push("```sh")
lines.push("cd " + import.meta.dir)
lines.push("bun extract-gp.ts    # writes gp.json")
lines.push("bun extract-csjs.ts  # writes csjs.json")
lines.push("bun compare.ts       # writes report.md")
lines.push("```")
lines.push("")

await Bun.write("report.md", lines.join("\n"))
console.log(lines.join("\n"))