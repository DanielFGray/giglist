import { barreOf, fretWindow, writeFrets, type Voicing } from "~/charts/fretting"

/**
 * One guitar shape drawn as a vertical chord box: strings as vertical lines
 * with the lowest string on the left, frets as horizontal lines, a filled dot
 * in a fretted string's cell and one rounded bar for the barre. Everything
 * is drawn in `currentColor`, so the diagram takes the color of the text
 * around it and reads on the light page and the dark stage view, and the
 * size is in em so it scales with the chart text.
 *
 * `labels` names the degree of every note the shape sounds, open strings
 * included, in the same order as `frets`, so a player can read what each note
 * is; `numeral` is the chord's Roman numeral for the key the chart is shown in.
 * Both are optional; without them the box shows the shape alone.
 */
export function ChordDiagram({
  frets,
  name,
  numeral,
  labels,
  onClick,
}: {
  frets: Voicing["frets"]
  name?: string
  numeral?: string
  labels?: ReadonlyArray<string | null>
  onClick?: () => void
}) {
  const view = fretWindow(frets)
  const barre = barreOf(frets)
  const strings = frets.length
  // The name, the numeral and the ○/× row stack above the grid; without a name the grid rises.
  const head = (name === undefined ? 0 : NAME_SPACE) + (numeral === undefined ? 0 : NUMERAL_SPACE)
  const openY = head + OPEN_ROW
  const gridTop = openY + NUT_GAP
  const bottom = gridTop + view.rows * ROW
  const column = (i: number) => LEFT + i * GAP
  const cellMid = (fret: number) => gridTop + (fret - view.first + 0.5) * ROW
  const lines = { x1: column(0) - OVERHANG, x2: column(strings - 1) + OVERHANG }
  return (
    <svg
      data-pwid="chord-diagram"
      data-frets={writeFrets(frets)}
      role={onClick ? "button" : "img"}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`${name ?? "Chord shape"}: ${writeFrets(frets)}${onClick ? ", play" : ""}`}
      viewBox={`0 0 ${widthOf(strings)} ${bottom + FOOT}`}
      width={`${widthOf(strings) / EM}em`}
      className={`block overflow-visible ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <ChordHead name={name} numeral={numeral} x={(column(0) + column(strings - 1)) / 2} />

      <StringMarks frets={frets} labels={labels} column={column} y={openY} />

      {/* The window's fret lines, headlined by the nut when the box starts at fret 1. */}
      {Array.from({ length: view.rows + 1 }, (_, row) => (
        <line
          key={row}
          {...lines}
          y1={gridTop + row * ROW}
          y2={gridTop + row * ROW}
          stroke="currentColor"
          strokeWidth={row === 0 && view.first === 1 ? NUT : 1.2}
        />
      ))}

      {frets.map((_, i) => (
        <line key={i} x1={column(i)} x2={column(i)} y1={gridTop} y2={bottom} stroke="currentColor" strokeWidth={1.2} />
      ))}

      {/* The first-fret label beside the first row when the nut is not drawn. */}
      {view.first !== 1 && (
        <text x={lines.x1 - 4} y={gridTop + ROW / 2} textAnchor="end" dominantBaseline="middle" fontSize={LABEL_FONT} fill="currentColor">
          {view.first}fr
        </text>
      )}

      {/* A dot per fretted string; the barre's strings sit under the bar instead. */}
      {frets.map((fret, i) => {
        if (fret === null || fret === 0) return null
        if (barre !== null && fret === barre.fret && i >= barre.from && i <= barre.to) return null
        return <circle key={i} cx={column(i)} cy={cellMid(fret)} r={R} fill="currentColor" />
      })}

      {barre !== null && (
        <rect
          x={column(barre.from) - R - 1}
          y={cellMid(barre.fret) - BAR_HEIGHT / 2}
          width={column(barre.to) - column(barre.from) + 2 * (R + 1)}
          height={BAR_HEIGHT}
          rx={R + 1}
          fill="currentColor"
        />
      )}

      {labels !== undefined && <DegreeLabels frets={frets} labels={labels} column={column} cellMid={cellMid} openY={openY} />}
    </svg>
  )
}

/** The chord's name, and its Roman numeral under the name when the chart is in a known key. */
function ChordHead({ name, numeral, x }: { name?: string; numeral?: string; x: number }) {
  return (
    <>
      {name !== undefined && (
        <text x={x} y={NAME_Y} textAnchor="middle" fontSize={NAME_FONT} fontWeight="bold" fill="currentColor">
          {name}
        </text>
      )}
      {numeral !== undefined && (
        <text data-pwid="shapes-numeral" x={x} y={NAME_Y + NUMERAL_SPACE} textAnchor="middle" fontSize={NUMERAL_FONT} fill="currentColor">
          {numeral}
        </text>
      )}
    </>
  )
}

/**
 * What each string shows above the box: × where it is muted, ○ where it plays
 * open. An open string with a degree label shows the label there instead (see
 * DegreeLabels), so the ○ is drawn only when there is none.
 */
function StringMarks({
  frets,
  labels,
  column,
  y,
}: {
  frets: Voicing["frets"]
  labels?: ReadonlyArray<string | null>
  column: (string: number) => number
  y: number
}) {
  return (
    <>
      {frets.map((fret, i) => {
        if (fret === null) return <path key={i} d={cross(column(i), y)} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        if (fret !== 0 || (labels?.[i] ?? null) !== null) return null
        return <circle key={i} cx={column(i)} cy={y} r={2.8} fill="none" stroke="currentColor" strokeWidth={1.4} />
      })}
    </>
  )
}

/**
 * Each sounding string's degree, in string order: an open string's on the ○ row
 * in the ○'s place, a fretted one above its dot (the barre's strings included).
 */
function DegreeLabels({
  frets,
  labels,
  column,
  cellMid,
  openY,
}: {
  frets: Voicing["frets"]
  labels: ReadonlyArray<string | null>
  column: (string: number) => number
  cellMid: (fret: number) => number
  openY: number
}) {
  return (
    <>
      {frets.map((fret, i) => {
        const label = labels[i] ?? null
        if (fret === null || label === null) return null
        const y = fret === 0 ? openY + LABEL_LIFT : cellMid(fret) - LABEL_LIFT
        return (
          <text key={i} data-pwid="chord-degree" x={column(i)} y={y} textAnchor="middle" fontSize={DEGREE_FONT} fill="currentColor">
            {label}
          </text>
        )
      })}
    </>
  )
}

// The box's measures in viewBox units; one em of chart text spans EM of them,
// so the width holds at about 4.5em whatever the shape needs in rows.
const EM = 20
const GAP = 12
const LEFT = 24 // the lowest-pitched string's column
const OVERHANG = 4 // fret lines run past the outer strings
const ROW = 18
const R = 3.4 // dot radius, and the barre's rounding
const BAR_HEIGHT = 7
const NUT = 4.5
const OPEN_ROW = 9 // the ○/× row's center
const NUT_GAP = 7 // from the ○/× row to the nut line
const NAME_SPACE = 20
const NAME_Y = 13 // the name's text baseline
const NAME_FONT = 18
const NUMERAL_SPACE = 16
const NUMERAL_FONT = 14
const LABEL_FONT = 10
const DEGREE_FONT = 8
// A degree above a dot sits inside that cell, and one above an open string sits
// on the ○/× row; the lift keeps both off the fret lines.
const LABEL_LIFT = 5.5
const FOOT = 3

const widthOf = (strings: number) => LEFT + (strings - 1) * GAP + OVERHANG + 2

/** An × centered on `x`, `y` as one stroke path. */
const cross = (x: number, y: number) => `M ${x - 2.3} ${y - 2.3} L ${x + 2.3} ${y + 2.3} M ${x - 2.3} ${y + 2.3} L ${x + 2.3} ${y - 2.3}`
