/**
 * Reads a chord name into the pitch classes a guitar shape must hold and the ones it
 * may leave out. Pure and free of the DOM, so the view and the tests share it.
 */

/** 0 = C … 11 = B */
export type PitchClass = number

export type Spelling = {
  readonly root: PitchClass
  /** The lowest note a shape must sound: the slash note, or the root. */
  readonly bass: PitchClass
  /** Notes every shape must hold. Includes root and bass. */
  readonly required: ReadonlyArray<PitchClass>
  /** Notes a shape may hold or leave out. Disjoint from required. */
  readonly optional: ReadonlyArray<PitchClass>
}

export function spell(name: string): Spelling | null {
  const root = readNote(name, 0)
  if (root === null) return null

  const slash = findSlashBass(name, root.end)
  const bass = slash === null ? root.pitchClass : slash.pitchClass
  const chord = readSuffix(name.slice(root.end, slash === null ? name.length : slash.at))
  if (chord === null) return null

  const { tones, required, extensions } = chord
  // A 13 implies the 9th and 11th below it, and an 11 implies the 9th. A player
  // commonly leaves those out, so they are added as optional, never required.
  if (extensions.has(13)) {
    if (!tones.has(9)) tones.set(9, DEGREE[9])
    if (!tones.has(11)) tones.set(11, DEGREE[11])
  } else if (extensions.has(11) && !tones.has(9)) {
    tones.set(9, DEGREE[9])
  }
  // The natural 11th sits a half step above the major 3rd, so a major 13 leaves it
  // out. A sus or a minor 13 has no major 3rd for it to clash with.
  if (extensions.has(13) && !chord.sus && chord.third === 4) tones.delete(11)

  const must = new Set<PitchClass>([root.pitchClass, bass])
  const may = new Set<PitchClass>()
  for (const [degree, semitones] of tones) {
    if (degree === 1) continue
    const pitchClass = (root.pitchClass + semitones) % 12
    if (degree === 3 && !chord.thirdRequired) may.add(pitchClass)
    else if (degree === 5 && !chord.fifthRequired) may.add(pitchClass)
    else if (required.has(degree)) must.add(pitchClass)
    else may.add(pitchClass)
  }
  // Two degrees can share a pitch class — the sus 4th is the natural 11th — so a
  // note no shape may leave out is not also one a shape may leave out.
  for (const pitchClass of may) if (must.has(pitchClass)) may.delete(pitchClass)
  return { root: root.pitchClass, bass, required: ascending(must), optional: ascending(may) }
}

/** What the suffix of a name said: the tones it produced, and how to hold them. */
type Suffix = {
  /** Chord degree -> semitones from the root. */
  readonly tones: Map<number, number>
  /** The degrees a shape must sound, by the name's own rules. */
  readonly required: Set<number>
  /** The degrees a 7, 9, 11 or 13 named. An added or altered tone is not one. */
  readonly extensions: Set<number>
  /** The 3rd or its sus tone, as semitones; null for a power chord or `no3`. */
  readonly third: number | null
  readonly thirdRequired: boolean
  readonly fifthRequired: boolean
  /** True when the 3rd was replaced by a 2nd or a 4th. */
  readonly sus: boolean
}

const NATURALS: Readonly<Record<string, PitchClass>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Semitones above the root of each chord degree. A 6th is a 13th. */
const DEGREE = { 2: 2, 4: 5, 5: 7, 7: 11, 9: 2, 11: 5, 13: 9 } as const

/** Characters that separate tokens without saying anything. */
const SEPARATORS = new Set(["(", ")", ",", " ", "/"])

function readSuffix(suffix: string): Suffix | null {
  const tones = new Map<number, number>([
    [1, 0],
    [3, 4],
    [5, 7],
  ])
  // The 3rd and the 5th are held until a rule below releases one of them.
  const required = new Set<number>([3, 5])
  const extensions = new Set<number>()
  let third: number | null = 4
  let susDegree: number | null = null
  let hasFifth = true
  let fifthAltered = false
  let diminished = false
  let augmented = false
  let minor = false
  let power = false
  // `maj`, `ma`, `M` and `j` only say which 7th a following 7, 9, 11 or 13 takes.
  // A name that names no such tone after them is a plain major triad.
  let naturalSeventh = false
  let seventh: number | null = null
  // A bare 2 on an unnamed triad leaves the 3rd to the shape, but the shape may hold it.
  let thirdReleased = false

  const readTone = (degree: number, semitones: number, held: boolean) => {
    tones.set(degree, semitones)
    if (held) required.add(degree)
  }
  const alter = (degree: 5 | 9 | 11 | 13, semitones: number) => {
    readTone(degree, semitones, true)
    if (degree === 5) fifthAltered = true
  }
  const readSeventh = () => {
    if (seventh !== null) return
    seventh = diminished ? 9 : naturalSeventh ? 11 : 10
  }

  let at = 0
  while (at < suffix.length) {
    if (SEPARATORS.has(suffix[at]!)) {
      at += 1
      continue
    }

    // `+5` and `-9` are alterations; a `+` or `-` with nothing to alter is a quality.
    const plus = take(suffix, at, "+") !== null
    const minus = !plus && take(suffix, at, "-") !== null
    const altered = plus || minus
    const alteredDegree = altered ? takeLongest(suffix, at + 1, ["11", "13", "9", "5"]) : null
    if (altered && alteredDegree !== null) {
      const plain = DEGREE[Number(alteredDegree) as 5 | 9 | 11 | 13]
      alter(Number(alteredDegree) as 5 | 9 | 11 | 13, plus ? plain + 1 : plain - 1)
      at += 1 + alteredDegree.length
      continue
    }

    const marker = takeLongest(suffix, at, ["maj", "Maj", "min", "mi", "ma", "M", "Δ", "j", "m", "-"])
    if (marker !== null) {
      // `Cmadd9` is Cm(add9), so an `m` in front of `add` is minor, not the head of `maj`.
      const beforeAdd = marker === "ma" && suffix.startsWith("add", at + 1)
      if (beforeAdd) {
        minor = true
        third = 3
      } else if (marker === "min" || marker === "mi" || marker === "m" || marker === "-") {
        minor = true
        third = 3
      } else if (marker === "Δ") {
        // A delta on its own is the whole name for a major 7th.
        naturalSeventh = true
        readSeventh()
      } else {
        naturalSeventh = true
      }
      at += beforeAdd ? 1 : marker.length
      continue
    }

    if (take(suffix, at, "ø") !== null) {
      minor = true
      third = 3
      alter(5, 6)
      readSeventh()
      at += 1
      continue
    }
    // Read before `o`, or the `o` of `omit5` would read as a diminished triad.
    const omitted = takeLongest(suffix, at, ["omit", "no"])
    if (omitted !== null) {
      const degree = takeLongest(suffix, at + omitted.length, ["3", "5"])
      if (degree === null) return null
      tones.delete(Number(degree))
      required.delete(Number(degree))
      if (degree === "3") third = null
      else hasFifth = false
      at += omitted.length + 1
      continue
    }

    const quality = takeLongest(suffix, at, ["dim", "°", "o", "aug", "+"])
    if (quality !== null) {
      if (quality === "aug" || quality === "+") {
        augmented = true
        alter(5, 8)
      } else {
        diminished = true
        third = 3
        alter(5, 6)
      }
      at += quality.length
      continue
    }

    if (take(suffix, at, "sus") !== null) {
      const number = takeLongest(suffix, at + 3, ["2", "4"])
      susDegree = number === "2" ? 2 : 4
      third = number === "2" ? DEGREE[2] : DEGREE[4]
      tones.delete(3)
      readTone(susDegree, third, true)
      at += 3 + (number === null ? 0 : 1)
      continue
    }

    if (take(suffix, at, "add") !== null) {
      const degree = takeLongest(suffix, at + 3, ["11", "13", "9", "4", "2"])
      if (degree === null) return null
      readTone(Number(degree), DEGREE[Number(degree) as 2 | 4 | 9 | 11 | 13], true)
      at += 3 + degree.length
      continue
    }

    const flat = take(suffix, at, "b") !== null || take(suffix, at, "♭") !== null
    const sharp = take(suffix, at, "#") !== null || take(suffix, at, "♯") !== null
    if (flat || sharp) {
      const degree = takeLongest(suffix, at + 1, ["11", "13", "9", "5"])
      if (degree === null) return null
      const plain = DEGREE[Number(degree) as 5 | 9 | 11 | 13]
      // An altered tone replaces the plain tone it names, so `13b9` has no 9th.
      alter(Number(degree) as 5 | 9 | 11 | 13, flat ? plain - 1 : plain + 1)
      at += 1 + degree.length
      continue
    }

    const number = takeLongest(suffix, at, ["13", "11", "9", "7", "6", "5", "4", "2"])
    if (number === null) return null
    at += number.length
    switch (number) {
      case "7":
        readSeventh()
        break
      case "9":
        // A 9 that arrives after a 6 is the other half of a sixth chord, which has no 7th.
        if (seventh === null && !tones.has(13)) readSeventh()
        extensions.add(9)
        readTone(9, DEGREE[9], true)
        break
      case "11":
        readSeventh()
        extensions.add(11)
        readTone(11, DEGREE[11], true)
        break
      case "13":
        readSeventh()
        extensions.add(13)
        readTone(13, DEGREE[13], true)
        break
      case "6":
        // A 6th is a 13th, but it names no chain of its own: `C6` is a triad with
        // a 6th on it, and only a `9` or an `11` brings tones in below it.
        readTone(13, DEGREE[13], true)
        break
      case "5":
        power = true
        third = null
        tones.delete(3)
        break
      default: {
        const degree = Number(number) as 2 | 4
        // A bare 2 on an unnamed triad may go without its 3rd: `A2`, `D2` and `G2`
        // are written as two-note shapes in ChordSheetJS's own table. A named minor
        // or augmented triad asks for its 3rd, and a bare 4 never takes it away.
        if (degree === 2 && !minor && !diminished && !augmented && susDegree === null) thirdReleased = true
        readTone(degree, DEGREE[degree], true)
        break
      }
    }
  }

  if (!hasFifth) tones.delete(5)
  if (third === null) tones.delete(3)
  // A sus tone stands in the 3rd's own slot, so the 3rd keeps its place off the map.
  else if (susDegree === null) tones.set(3, third)
  if (seventh !== null) readTone(7, seventh, true)

  // A dominant 11 may drop its 3rd: the 11th is a half step above it, an octave
  // up, and players leave the 3rd out to avoid the clash. A minor 11 has no clash.
  const thirdRequired = third !== null && !thirdReleased && !(extensions.has(11) && !minor)
  return {
    tones,
    required,
    extensions,
    third,
    thirdRequired,
    fifthRequired: fifthAltered || power,
    sus: susDegree !== null,
  }
}

/** Reads a letter A-G with an optional accidental, as a root or a slash bass. */
function readNote(text: string, at: number): { pitchClass: PitchClass; end: number } | null {
  const natural = NATURALS[text[at]!]
  if (natural === undefined) return null
  let semitones = natural
  let end = at + 1
  while (end < text.length && isAccidental(text[end]!)) {
    semitones += text[end] === "#" || text[end] === "♯" ? 1 : -1
    end += 1
  }
  return { pitchClass: ((semitones % 12) + 12) % 12, end }
}

/**
 * Finds the bass note a slash introduces, or null when the name has none. The `/9`
 * of `6/9` and the `/7` of `m6/7` name a tone, so only a note running to the end
 * of the name counts.
 */
function findSlashBass(name: string, from: number): { pitchClass: PitchClass; at: number } | null {
  for (let at = from; at < name.length; at += 1) {
    if (name[at] !== "/") continue
    const note = readNote(name, at + 1)
    if (note !== null && note.end === name.length) return { pitchClass: note.pitchClass, at }
  }
  return null
}

function isAccidental(character: string): boolean {
  return character === "#" || character === "b" || character === "♯" || character === "♭"
}

/** Consumes `word` at `at`, or reports nothing there. */
function take(text: string, at: number, word: string): string | null {
  return text.startsWith(word, at) ? word : null
}

/** Consumes whichever of `words` is longest at `at`, or reports nothing there. */
function takeLongest(text: string, at: number, words: ReadonlyArray<string>): string | null {
  let best: string | null = null
  for (const word of words) {
    if (text.startsWith(word, at) && (best === null || word.length > best.length)) best = word
  }
  return best
}

function ascending(pitchClasses: ReadonlySet<PitchClass>): ReadonlyArray<PitchClass> {
  return [...pitchClasses].sort((a, b) => a - b)
}
