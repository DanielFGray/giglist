import { describe, expect, test } from "bun:test"
import { ChordProParser } from "chordsheetjs"
import { MusicalKeys } from "../api/songs"
import { renderLyrics } from "./lyrics"

/**
 * Transposition is ChordSheetJS's. These tests check it against an independent
 * oracle, the letter-name spelling of a scale, for every pair of keys of the
 * same mode that the oracle can spell without double accidentals.
 */
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const
const NATURAL = [0, 2, 4, 5, 7, 9, 11]
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

const split = (key: string) => ({ root: key.replace(/m$/, ""), minor: key.endsWith("m") })
const semitone = (root: string) => {
  const accidental = root.endsWith("#") ? 1 : root.endsWith("b") ? -1 : 0
  return (NATURAL[LETTERS.indexOf(root[0] as (typeof LETTERS)[number])]! + accidental + 12) % 12
}

/** The seven scale roots of `key`, or null when spelling them needs a double accidental. */
function scaleRoots(key: string): Array<string> | null {
  const { root, minor } = split(key)
  const start = LETTERS.indexOf(root[0] as (typeof LETTERS)[number])
  const roots: Array<string> = []
  for (const [degree, interval] of (minor ? MINOR : MAJOR).entries()) {
    const letter = LETTERS[(start + degree) % 7]!
    const wanted = (semitone(root) + interval) % 12
    const offset = ((wanted - NATURAL[LETTERS.indexOf(letter)]! + 18) % 12) - 6
    if (offset < -1 || offset > 1) return null
    roots.push(letter + (offset === 1 ? "#" : offset === -1 ? "b" : ""))
  }
  return roots
}

const chartIn = (key: string, roots: ReadonlyArray<string>) =>
  `{key: ${key}}\n${roots.map((r) => `[${r}]la`).join(" ")}`

const shownRoots = (source: string, key: string) =>
  renderLyrics(source, key)
    .flat()
    .flatMap((item) => (item.kind === "pair" && item.chord ? [item.chord] : []))

const pairs = MusicalKeys.flatMap((from) =>
  MusicalKeys.filter((to) => to !== from && split(to).minor === split(from).minor).flatMap((to) => {
    const [a, b] = [scaleRoots(from), scaleRoots(to)]
    return a && b ? [{ from, to, a, b }] : []
  }),
)

describe("transposition against a letter-name oracle", () => {
  test("covers a large share of the same-mode key pairs", () => {
    expect(pairs.length).toBeGreaterThan(380)
  })

  test("every pair spells the scale of the shown key", () => {
    for (const { from, to, a, b } of pairs) {
      expect({ from, to, shown: shownRoots(chartIn(from, a), to) }).toEqual({ from, to, shown: b })
    }
  })

  test("transposing there and back restores the chords", () => {
    for (const { from, to, a } of pairs) {
      const there = new ChordProParser().parse(chartIn(from, a)).changeKey(to)
      const back = there.changeKey(from)
      const chords = back.lines.flatMap((l) => l.items.flatMap((i) => ("chords" in i && i.chords ? [i.chords] : [])))
      expect({ from, to, chords }).toEqual({ from, to, chords: a })
    }
  })
})
