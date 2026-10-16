/**
 * Reads ChordSheetJS's own guitar chord table and writes every entry as
 * { name, frets } with frets lowest string first, null = not played.
 *
 * The table's `base-fret` is read two ways and the reading whose notes fit the
 * name's own spelling wins. The three readings tried, in order:
 *   "absolute"      pos, used when base-fret is 0 or 1
 *   "pos+base-1"    absolute = pos + base - 1
 *   "pos+base"      absolute = pos + base
 */
import { ChordProParser } from "./vendor"
import { spell } from "/home/dan/build/setlist/src/charts/spelling"

type ChordDefinition = {
  name: string
  /** Lowest string first; "x" or a null for a muted string. */
  frets: Array<string | number | null>
  baseFret?: number
  fingers?: number[]
}

export type Reference = {
  readonly name: string
  readonly frets: ReadonlyArray<number | null>
  readonly reading: "absolute" | "pos+base-1" | "pos+base"
}

type ParsedSong = { chordDefinitions: { withDefaults(): { definitions: Record<string, ChordDefinition> } } }

const song = new ChordProParser().parse("{title: x}") as ParsedSong
const definitions: ChordDefinition[] = Object.values(song.chordDefinitions.withDefaults().definitions)

/** Every pitch class the name allows, so a reading can be judged against them. */
function allowed(name: string): Set<number> | null {
  const chord = spell(name)
  if (chord === null) return null
  return new Set([...chord.required, ...chord.optional])
}

/** `["x", 3, 2, 0, 1, 0]` -> [null, 3, 2, 0, 1, 0]. */
function parseFrets(tokens: ReadonlyArray<string | number | null>): Array<number | null> {
  const frets: Array<number | null> = []
  for (const token of tokens) {
    if (token === null || token === "x" || token === "X") frets.push(null)
    else {
      const fret = typeof token === "number" ? token : Number.parseInt(token, 10)
      if (Number.isNaN(fret)) return []
      frets.push(fret)
    }
  }
  return frets
}

const READINGS = ["absolute", "pos+base-1", "pos+base"] as const

function read(positions: Array<number | null>, base: number, reading: (typeof READINGS)[number]): Array<number | null> {
  return positions.map((pos) => {
    if (pos === null) return null
    if (reading === "absolute") return pos
    return reading === "pos+base-1" ? pos + base - 1 : pos + base
  })
}

const TUNING = [40, 45, 50, 55, 59, 64]
/** Pitch classes the shape sounds, or null when a fret is outside the neck. */
function heard(frets: ReadonlyArray<number | null>): Set<number> | null {
  const set = new Set<number>()
  for (const [i, fret] of frets.entries()) {
    if (fret === null) continue
    if (fret > 15) return null
    set.add((TUNING[i]! + fret) % 12)
  }
  return set
}

const out: Array<Reference> = []
const unreadable: Array<{ name: string; reason: string }> = []
const noReading: Array<{ name: string; text: string; base: number }> = []
const readings: Record<string, number> = { absolute: 0, "pos+base-1": 0, "pos+base": 0 }

for (const definition of definitions) {
  const name = definition.name
  const chord = spell(name)
  if (chord === null) {
    unreadable.push({ name, reason: "spell() returned null" })
    continue
  }
  const allowedSet = allowed(name)!
  // base-fret 0 or 1 makes every reading the same, so it is read as absolute.
  const base = definition.baseFret ?? 0
  const useReadings: Array<typeof READINGS[number]> = base <= 1 ? ["absolute"] : [...READINGS]
  const positions = parseFrets(definition.frets ?? [])
  const text = (definition.frets ?? []).map((f) => (f === null ? "x" : String(f))).join(" ")
  if (positions.length !== 6) {
    noReading.push({ name, text, base })
    continue
  }
  let chosen: Reference | null = null
  for (const reading of useReadings) {
    const frets = read(positions, base, reading)
    const set = heard(frets)
    if (set === null) continue
    // The reading is right when every note it sounds belongs to the name.
    if (![...set].every((pc) => allowedSet.has(pc))) continue
    if (!chord.required.every((pc) => set.has(pc))) continue
    chosen = { name, frets, reading }
    break
  }
  if (chosen === null) {
    noReading.push({ name, text, base })
    continue
  }
  readings[chosen.reading] += 1
  out.push(chosen)
}

await Bun.write("csjs.json", JSON.stringify(out, null, 1))
// compare.ts needs the counts the report must state, so they go in a file, not a log line.
await Bun.write(
  "csjs-stats.json",
  JSON.stringify(
    {
      tableEntries: definitions.length,
      readings,
      noReadingCount: noReading.length,
      noReading: noReading.slice(0, 40),
      unreadableCount: unreadable.length,
      unreadable: unreadable.slice(0, 40),
    },
    null,
    1,
  ),
)
console.log("table entries", definitions.length)
console.log("readings used", JSON.stringify(readings))
console.log("no reading fit", noReading.length, JSON.stringify(noReading.slice(0, 15)))
console.log("names spell() cannot read", unreadable.length, JSON.stringify(unreadable.slice(0, 15)))
console.log("distinct shapes", new Set(out.map((r) => `${r.name}\t${r.frets.join(" ")}`)).size)
console.log("sample", JSON.stringify(out.slice(0, 6)))