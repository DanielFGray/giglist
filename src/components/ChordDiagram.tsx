import { barreOf, fretWindow, writeFrets, type Voicing } from "~/charts/fretting"

/**
 * One guitar shape drawn as a vertical chord box: strings as vertical lines
 * with the lowest string on the left, frets as horizontal lines, a filled dot
 * in a fretted string's cell and one rounded bar for the barre. Everything
 * is drawn in `currentColor`, so the diagram takes the color of the text
 * around it and reads on the light page and the dark stage view, and the
 * size is in em so it scales with the chart text.
 */
export function ChordDiagram({ frets, name }: { frets: Voicing["frets"]; name?: string }) {
  const view = fretWindow(frets)
  const barre = barreOf(frets)
  const strings = frets.length
  // The name and the ○/× row stack above the grid; without a name the grid rises.
  const head = name === undefined ? 0 : NAME_SPACE
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
      role="img"
      aria-label={`${name ?? "Chord shape"}: ${writeFrets(frets)}`}
      viewBox={`0 0 ${widthOf(strings)} ${bottom + FOOT}`}
      width={`${widthOf(strings) / EM}em`}
      className="block overflow-visible"
    >
      {name !== undefined && (
        <text x={(column(0) + column(strings - 1)) / 2} y={NAME_Y} textAnchor="middle" fontSize={NAME_FONT} fill="currentColor">
          {name}
        </text>
      )}

      {/* ○ above an open string, × above a not-played one. */}
      {frets.map((fret, i) =>
        fret === null ? (
          <path key={i} d={cross(column(i), openY)} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        ) : fret === 0 ? (
          <circle key={i} cx={column(i)} cy={openY} r={2.8} fill="none" stroke="currentColor" strokeWidth={1.4} />
        ) : null,
      )}

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
    </svg>
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
const NAME_SPACE = 12
const NAME_Y = 10 // the name's text baseline
const NAME_FONT = 9
const LABEL_FONT = 8
const FOOT = 3

const widthOf = (strings: number) => LEFT + (strings - 1) * GAP + OVERHANG + 2

/** An × centered on `x`, `y` as one stroke path. */
const cross = (x: number, y: number) => `M ${x - 2.3} ${y - 2.3} L ${x + 2.3} ${y + 2.3} M ${x - 2.3} ${y + 2.3} L ${x + 2.3} ${y - 2.3}`
