/** Fits the shape ranking's weights to ChordSheetJS's table; validates on the Guitar Pro diagrams. */
import { spell, type Spelling } from "/home/dan/build/setlist/src/charts/spelling"
import { fingersNeeded, writeFrets } from "/home/dan/build/setlist/src/charts/fretting"
import { shapesIn, HIGHEST_FRET, STANDARD_TUNING } from "./gen"

type Frets = ReadonlyArray<number | null>
const T = STANDARD_TUNING
const FEATURES = ["im", "om", "fi", "sp", "lo", "n", "un"] as const
type W = Record<(typeof FEATURES)[number], number>

function features(frets: Frets, chord: Spelling): Array<number> {
  const sounding = frets.flatMap((f, i) => (f === null ? [] : [i]))
  const fretted = frets.filter((f): f is number => f !== null && f > 0)
  const lo = fretted.length ? Math.min(...fretted) : 0
  const sp = fretted.length ? Math.max(...fretted) - lo : 0
  const pitches = sounding.map((i) => T[i]! + frets[i]!)
  const heard = new Set(pitches.map((p) => p % 12))
  const om = chord.optional.filter((pc) => !heard.has(pc)).length
  const im = sounding.length ? sounding.at(-1)! - sounding[0]! + 1 - sounding.length : 0
  const un = pitches.length - new Set(pitches).size
  return [im, om, fingersNeeded(frets), sp, lo, sounding.length, un]
}

type Case = { name: string; ref: string; cands: Array<{ key: string; frets: Frets; f: Array<number> }> }
export function build(refs: Array<{ name: string; frets: Frets }>): Array<Case> {
  const cases: Array<Case> = []
  const cache = new Map<string, Case["cands"]>()
  for (const r of refs) {
    const chord = spell(r.name)
    if (!chord) continue
    let cands = cache.get(r.name)
    if (!cands) {
      const found = new Map<string, Frets>()
      for (let s = 1; s <= HIGHEST_FRET - 3; s++) for (const f of shapesIn(chord, T, s)) found.set(writeFrets(f), f)
      cands = [...found].map(([key, frets]) => ({ key, frets, f: features(frets, chord) }))
      cache.set(r.name, cands)
    }
    const ref = writeFrets(r.frets)
    if (!cands.some((c) => c.key === ref)) continue // not playable by our rules
    cases.push({ name: r.name, ref, cands })
  }
  return cases
}

/** Position of the reference in the shown list (1-based), or 99 when dropped or past 8. */
export function position(c: Case, w: Array<number>): number {
  const scored = c.cands.map((x) => ({ x, s: x.f.reduce((a, v, i) => a + v * w[i]!, 0) }))
  scored.sort((a, b) => a.s - b.s || a.x.key.localeCompare(b.x.key))
  const kept: Array<Frets> = []
  for (const { x } of scored) {
    if (kept.some((b) => x.frets.every((f, i) => f === null || f === b[i]))) { if (x.key === c.ref) return 99; continue }
    kept.push(x.frets)
    if (x.key === c.ref) return kept.length
    if (kept.length === 8) return 99
  }
  return 99
}

function evaluate(cases: Array<Case>, w: Array<number>) {
  let t1 = 0, t3 = 0, t8 = 0
  for (const c of cases) { const p = position(c, w); if (p === 1) t1++; if (p <= 3) t3++; if (p <= 8) t8++ }
  const n = cases.length
  return { t1: t1 / n, t3: t3 / n, t8: t8 / n, n }
}
const objective = (r: ReturnType<typeof evaluate>) => r.t1 + 0.5 * r.t3 + 0.25 * r.t8

export function shown(c: Case, w: Array<number>): Array<string> {
  const scored = c.cands.map((x) => ({ x, s: x.f.reduce((a, v, i) => a + v * w[i]!, 0) }))
  scored.sort((a, b) => a.s - b.s || a.x.key.localeCompare(b.x.key))
  const kept: Array<{ key: string; frets: Frets }> = []
  for (const { x } of scored) {
    if (kept.some((b) => x.frets.every((f, i) => f === null || f === b.frets[i]))) continue
    kept.push(x)
    if (kept.length === 8) break
  }
  return kept.map((k) => k.key)
}
