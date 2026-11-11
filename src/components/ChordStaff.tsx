import { degreeName } from "~/charts/degrees"
import { numeral } from "~/charts/numeral"
import type { Spelling } from "~/charts/spelling"
import { staffNotes, staffSides, staffStep, type StaffNote } from "~/charts/staff"
import { alphaTabAssetUrls } from "alphatab-kit"

/**
 * One chord as stacked whole notes on a treble staff: no bar lines, no time
 * signature, no rhythm. Each notehead carries the chord degree it spells, so a
 * player who reads notes sees what the chord holds. Drawn in `currentColor`,
 * so it reads on the light page and on the dark stage view.
 */
export function ChordStaff({ spelling }: { spelling: Spelling }) {
  const notes = staffNotes(spelling)
  const fontDirectory = alphaTabAssetUrls().fontDirectory
  const layout = layOut(notes, spelling)
  return (
    <svg
      data-pwid="chord-staff"
      role="img"
      aria-label="Chord staff"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={`${layout.width / EM}em`}
      className="block overflow-visible"
    >
      <style>{`@font-face { font-family: "Bravura"; src: url("${fontDirectory}Bravura.woff2") format("woff2"), url("${fontDirectory}Bravura.woff") format("woff"); }`}</style>
      {layout.staffLines.map((y) => (
        <line key={y} x1={layout.staffLeft} x2={layout.staffRight} y1={y} y2={y} stroke="currentColor" strokeWidth={1} />
      ))}
      <text x={layout.clefX} y={layout.clefY} textAnchor="middle" dominantBaseline="central" fontSize={GLYPH_FONT} fontFamily="Bravura" fill="currentColor">
        {G_CLEF}
      </text>
      {layout.ledgers.map((ledger, index) => (
        <line key={index} x1={ledger.x1} x2={ledger.x2} y1={ledger.y} y2={ledger.y} stroke="currentColor" strokeWidth={1} />
      ))}
      {layout.placed.map((item, index) => (
        <text
          key={index}
          data-pwid="chord-staff-note"
          x={item.x}
          y={item.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={GLYPH_FONT}
          fontFamily="Bravura"
          fill="currentColor"
        >
          {NOTEHEAD_WHOLE}
        </text>
      ))}
      {layout.placed.map(
        (item, index) =>
          item.accidental !== null && (
            <text
              key={index}
              x={item.accidental.x}
              y={item.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={GLYPH_FONT}
              fontFamily="Bravura"
              fill="currentColor"
            >
              {item.accidental.glyph}
            </text>
          ),
      )}
      {layout.placed.map((item, index) => {
        if (item.label === null) return null
        return (
          <text
            key={index}
            data-pwid="chord-staff-degree"
            x={item.labelX}
            y={item.y}
            textAnchor="start"
            dominantBaseline="central"
            fontSize={DEGREE_FONT}
            fill="currentColor"
          >
            {item.label}
          </text>
        )
      })}
    </svg>
  )
}

/**
 * The staff view of one chord, as the panel and the chord strip draw it: the
 * name, the numeral when the key is known, and the chord's notes on a staff.
 */
export function ChordStaffBlock({ name, spelling, shownKey }: { name: string; spelling: Spelling; shownKey: string | null }) {
  const chordNumeral = numeral(name, shownKey)
  return (
    <div className="flex flex-col gap-1">
      <div className="text-center text-sm font-semibold">{name}</div>
      {chordNumeral !== null && (
        <div data-pwid="shapes-numeral" className="text-center text-xs text-zinc-500">
          {chordNumeral}
        </div>
      )}
      <ChordStaff spelling={spelling} />
    </div>
  )
}

// SMuFL glyphs from the Bravura font alphaTab already serves.
const G_CLEF = String.fromCharCode(0xe050)
const NOTEHEAD_WHOLE = String.fromCharCode(0xe0a2)
const ACCIDENTAL_FLAT = String.fromCharCode(0xe260)
const ACCIDENTAL_SHARP = String.fromCharCode(0xe262)
const ACCIDENTAL_DOUBLE_SHARP = String.fromCharCode(0xe263)
const ACCIDENTAL_DOUBLE_FLAT = String.fromCharCode(0xe264)
const ACCIDENTAL_TRIPLE_SHARP = String.fromCharCode(0xe265)
const ACCIDENTAL_TRIPLE_FLAT = String.fromCharCode(0xe266)

// Staff heights in letter steps from C0 (staffStep): E4 to F5, and the clef's G4.
const STAFF_LINES = [30, 32, 34, 36, 38]
const G_LINE = 32

const EM = 20
const SPACE = 10
const GLYPH_FONT = 40
const DEGREE_FONT = 9
const NOTE_SHIFT = 9
const ACC_GAP = 18
const ACC_COL = 11
const DEGREE_GAP = 14
const LABEL_COLUMN = 14
const LEDGER_HALF = 14

type PlacedNote = {
  diatonic: number
  x: number
  y: number
  accidental: { x: number; glyph: string } | null
  labelX: number
  label: string | null
}

function layOut(notes: ReturnType<typeof staffNotes>, spelling: Spelling): {
  width: number
  height: number
  staffLeft: number
  staffRight: number
  staffLines: ReadonlyArray<number>
  clefX: number
  clefY: number
  ledgers: ReadonlyArray<{ x1: number; x2: number; y: number }>
  placed: ReadonlyArray<PlacedNote>
} {
  const diatonics = notes.map(staffStep)
  const minRaw = Math.min(0, ...diatonics.map((d) => rawY(d)))
  const maxRaw = Math.max(40, ...diatonics.map((d) => rawY(d)))
  const topPad = 24
  const toY = (d: number) => rawY(d) - minRaw + topPad
  const height = maxRaw - minRaw + topPad + 24

  const sides = staffSides(diatonics)
  const accCols = accidentalColumns(notes, diatonics.map(toY))
  const maxCol = accCols.reduce((m, c) => Math.max(m, c), -1)
  const staffLeft = 8 + 34
  const baseX = staffLeft + (maxCol + 1) * ACC_COL + ACC_GAP + NOTE_SHIFT + 6
  const staffRight = baseX + NOTE_SHIFT + DEGREE_GAP + 30 + 10
  // Degree labels sit in a column right of the rightmost notehead. Labels a step
  // apart would overlap, so the label of a note pushed right by a second takes a
  // second column.
  const labelX = baseX + (sides.includes("right") ? NOTE_SHIFT : 0) + DEGREE_GAP
  const width = staffRight + 4
  const clefX = 8 + 14
  const clefY = toY(G_LINE)

  const placed: Array<PlacedNote> = notes.map((note, i) => {
    const x = baseX + (sides[i] === "left" ? -NOTE_SHIFT : sides[i] === "right" ? NOTE_SHIFT : 0)
    const y = toY(diatonics[i]!)
    const col = accCols[i]!
    const accidental = glyphOf(note.accidental)
    return {
      diatonic: diatonics[i]!,
      x,
      y,
      accidental: accidental === null ? null : { x: baseX - ACC_GAP - col * ACC_COL, glyph: accidental },
      labelX: labelX + (sides[i] === "right" ? LABEL_COLUMN : 0),
      label: labelOf(spelling, note.degree),
    }
  })

  const staffLines = STAFF_LINES.map(toY)
  const ledgers: Array<{ x1: number; x2: number; y: number }> = []
  placed.forEach((item) => {
    for (const d of ledgerLines(item.diatonic)) {
      ledgers.push({ x1: item.x - LEDGER_HALF, x2: item.x + LEDGER_HALF, y: toY(d) })
    }
  })
  return { width, height, staffLeft, staffRight, staffLines, clefX, clefY, ledgers, placed }
}

function rawY(diatonic: number): number {
  return (38 - diatonic) * (SPACE / 2)
}

function accidentalColumns(notes: ReadonlyArray<StaffNote>, ys: ReadonlyArray<number>): ReadonlyArray<number> {
  const cols: Array<number> = []
  const seen: Array<{ y: number; col: number }> = []
  notes.forEach((note, i) => {
    if (note.accidental === 0) {
      cols.push(-1)
      return
    }
    let col = 0
    while (seen.some((s) => s.col === col && Math.abs(s.y - ys[i]!) < 18)) col += 1
    cols.push(col)
    seen.push({ y: ys[i]!, col })
  })
  return cols
}

function glyphOf(accidental: number): string | null {
  if (accidental === -3) return ACCIDENTAL_TRIPLE_FLAT
  if (accidental === -2) return ACCIDENTAL_DOUBLE_FLAT
  if (accidental === -1) return ACCIDENTAL_FLAT
  if (accidental === 0) return null
  if (accidental === 1) return ACCIDENTAL_SHARP
  if (accidental === 2) return ACCIDENTAL_DOUBLE_SHARP
  if (accidental === 3) return ACCIDENTAL_TRIPLE_SHARP
  return null
}

function labelOf(spelling: Spelling, degree: StaffNote["degree"]): string | null {
  if (degree === null) return null
  const semitones = spelling.tones.get(degree)
  if (semitones === undefined) return null
  return degreeName(degree, semitones)
}

function ledgerLines(diatonic: number): ReadonlyArray<number> {
  const lines: Array<number> = []
  if (diatonic < 30) {
    const top = diatonic % 2 === 0 ? diatonic : diatonic + 1
    for (let d = 28; d >= top; d -= 2) lines.push(d)
  } else if (diatonic > 38) {
    const bottom = diatonic % 2 === 0 ? diatonic : diatonic - 1
    for (let d = 40; d <= bottom; d += 2) lines.push(d)
  }
  return lines
}
