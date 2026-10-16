/**
 * Guitar shapes for a spelled chord: every playable way to hold its notes in
 * one hand position, best first. Pure, so the chord panel and the tests share it.
 */
import type { PitchClass, Spelling } from "./spelling"
import { fingersNeeded, writeFrets, type Voicing } from "./fretting"

/** Open-string pitches as MIDI numbers, lowest string first. */
export const STANDARD_TUNING: ReadonlyArray<number> = [40, 45, 50, 55, 59, 64]

/**
 * Playable shapes for a chord, best first, at most 8. A shape is playable when
 * it sounds every required note and no note outside the chord, its lowest note
 * is the bass, at least 3 strings sound (2 for a power chord), its fretted
 * notes lie within 4 frets, and one hand can hold it (`fingersNeeded` ≤ 4).
 */
export function voicings(chord: Spelling, tuning: ReadonlyArray<number> = STANDARD_TUNING): ReadonlyArray<Voicing> {
  const found = new Map<string, Voicing>()
  // Fretted notes within 4 frets always lie in one window s..s+3, so searching
  // each window finds every playable shape; a shape found twice is kept once.
  for (let start = 1; start <= HIGHEST_FRET - 3; start++) {
    for (const frets of shapesIn(chord, tuning, start)) found.set(writeFrets(frets), { frets })
  }
  const ranked = [...found.values()]
    .map((shape) => ({ shape, score: scoreOf(shape.frets, chord, tuning) }))
    .sort((a, b) => a.score - b.score || writeFrets(a.shape.frets).localeCompare(writeFrets(b.shape.frets)))

  const kept: Array<Voicing> = []
  for (const { shape } of ranked) {
    // A shape that is a better one with strings left out shows the player nothing new.
    if (kept.some((better) => shape.frets.every((fret, i) => fret === null || fret === better.frets[i]))) continue
    kept.push(shape)
    if (kept.length === 8) break
  }
  return kept
}

const HIGHEST_FRET = 15

/**
 * Lower is better. Each sounding string earns a point and a half, so a fuller
 * shape wins until it costs more to hold than it adds. Each finger costs one;
 * each fret of stretch, each fret up the neck and each optional note left out
 * cost two. A string left out between two sounding strings must be damped by
 * the hand, and costs four. Two strings on one pitch cost six: the second adds
 * nothing to the sound, as with the low E string fretted at 5 under an open A.
 *
 * The weights were fitted to ChordSheetJS's chord table: its shape for a name
 * is our first for 38% of names and in our first three for 60%.
 */
function scoreOf(frets: Voicing["frets"], chord: Spelling, tuning: ReadonlyArray<number>): number {
  const sounding = soundingStrings(frets)
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0)
  const lowest = fretted.length === 0 ? 0 : Math.min(...fretted)
  const span = fretted.length === 0 ? 0 : Math.max(...fretted) - lowest
  const pitches = sounding.map((i) => tuning[i]! + frets[i]!)
  const heard = new Set(pitches.map(pitchClassOf))
  const optionalMissing = chord.optional.filter((pc) => !heard.has(pc)).length
  const interiorMutes = sounding.length === 0 ? 0 : sounding.at(-1)! - sounding[0]! + 1 - sounding.length
  const unisons = pitches.length - new Set(pitches).size
  return (
    4 * interiorMutes + 2 * optionalMissing + fingersNeeded(frets) + 2 * span + 2 * lowest + 6 * unisons - 1.5 * sounding.length
  )
}

/** Every playable shape whose fretted notes lie in frets start..start+3. */
function shapesIn(chord: Spelling, tuning: ReadonlyArray<number>, start: number): Array<Voicing["frets"]> {
  const tones = new Set<PitchClass>([...chord.required, ...chord.optional])
  // Each string: not played, open, or a chord tone inside the window.
  const choices = tuning.map((open) => {
    const frets: Array<number | null> = [null]
    if (tones.has(pitchClassOf(open))) frets.push(0)
    for (let fret = start; fret <= start + 3; fret++) if (tones.has(pitchClassOf(open + fret))) frets.push(fret)
    return frets
  })
  const isPower = chord.optional.length === 0 && chord.required.length === 2
  const shapes: Array<Voicing["frets"]> = []
  // One array, filled string by string; only a playable shape is copied out.
  const frets: Array<number | null> = []
  const walk = (string: number) => {
    if (string === tuning.length) {
      if (playable(frets, chord, tuning, isPower ? 2 : 3)) shapes.push([...frets])
      return
    }
    for (const fret of choices[string]!) {
      frets[string] = fret
      walk(string + 1)
    }
  }
  walk(0)
  return shapes
}

/** The rules the window search does not already guarantee. */
function playable(frets: Voicing["frets"], chord: Spelling, tuning: ReadonlyArray<number>, fewestStrings: number): boolean {
  const sounding = soundingStrings(frets)
  if (sounding.length < fewestStrings) return false
  const pitches = sounding.map((i) => tuning[i]! + frets[i]!)
  // The lowest pitch, not the lowest string: a low string fretted high can sound above an open one.
  if (pitchClassOf(Math.min(...pitches)) !== chord.bass) return false
  const heard = new Set(pitches.map(pitchClassOf))
  if (!chord.required.every((pc) => heard.has(pc))) return false
  return fingersNeeded(frets) <= 4
}

function soundingStrings(frets: Voicing["frets"]): Array<number> {
  return frets.flatMap((fret, i) => (fret === null ? [] : [i]))
}

function pitchClassOf(pitch: number): PitchClass {
  return pitch % 12
}
