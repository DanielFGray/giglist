import { playPianoChord } from "~/audio/chord"
import { numeral } from "~/charts/numeral"
import { isBlack, keyRange, pianoNotes, type PianoNote } from "~/charts/piano"
import type { Spelling } from "~/charts/spelling"

/**
 * One chord as pressed keys on a keyboard trimmed to the chord's range. A circle
 * above each pressed key names the note as the chord spells it (`Eb`, not `D#`),
 * and the key itself shows the chord degree (`R`, `3`, `b7`), so a player can
 * read what to press or what each note does. Tapping it plays the chord. The size is
 * in em, so it scales with the chart text.
 *
 * Keys are the same on the light page and the dark stage view: white and black as
 * on a piano, with pressed keys in the accent color, so only the ink for labels
 * is fixed, not taken from the text color around the diagram.
 */
export function PianoDiagram({ spelling }: { spelling: Spelling }) {
  const notes = pianoNotes(spelling)
  const { low, high } = keyRange(notes.map((note) => note.pitch))
  const play = () => void playPianoChord(notes.map((note) => note.pitch))
  const pressed = new Map(notes.map((note) => [note.pitch, note]))
  const whites: Array<number> = []
  const blacks: Array<number> = []
  for (let pitch = low; pitch <= high; pitch += 1) (isBlack(pitch) ? blacks : whites).push(pitch)
  // A white key's left edge, in key widths from the keyboard's left; a black key sits on the edge between its neighbours.
  const whiteAt = (pitch: number) => whites.indexOf(pitch) * WHITE_W
  const blackAt = (pitch: number) => whiteAt(pitch + 1)
  const width = whites.length * WHITE_W
  return (
    <svg
      data-pwid="chord-piano"
      role="button"
      aria-label={`Play chord on piano: ${notes.map((note) => note.name).join(" ")}`}
      viewBox={`-1 -1 ${width + 2} ${HEAD + WHITE_H + 2}`}
      width={`${width / EM}em`}
      className="block overflow-visible cursor-pointer"
      tabIndex={0}
      onClick={play}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          play()
        }
      }}
    >
      {whites.map((pitch) => (
        <rect key={pitch} x={whiteAt(pitch)} y={HEAD} width={WHITE_W} height={WHITE_H} fill={pressed.has(pitch) ? ACCENT : WHITE_KEY} stroke={INK} strokeWidth={1} />
      ))}
      {blacks.map((pitch) => (
        <rect key={pitch} x={blackAt(pitch) - BLACK_W / 2} y={HEAD} width={BLACK_W} height={BLACK_H} fill={pressed.has(pitch) ? ACCENT : INK} stroke={INK} strokeWidth={1} />
      ))}
      {notes.map((note) => (
        <Pressed key={note.pitch} note={note} x={isBlack(note.pitch) ? blackAt(note.pitch) : whiteAt(note.pitch) + WHITE_W / 2} />
      ))}
    </svg>
  )
}

/**
 * The piano view of one chord, as the panel and the chord strip draw it: the
 * name, the numeral when the key is known, and the chord's keys.
 */
export function ChordPianoBlock({ name, spelling, shownKey }: { name: string; spelling: Spelling; shownKey: string | null }) {
  const chordNumeral = numeral(name, shownKey)
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-center text-sm font-semibold">{name}</div>
      {chordNumeral !== null && (
        <div data-pwid="shapes-numeral" className="text-center text-xs text-zinc-500">
          {chordNumeral}
        </div>
      )}
      <PianoDiagram spelling={spelling} />
    </div>
  )
}

/** A pressed key's two labels: the note name in a circle above the keyboard, the degree on the key. */
function Pressed({ note, x }: { note: PianoNote; x: number }) {
  const keyBottom = HEAD + (isBlack(note.pitch) ? BLACK_H : WHITE_H)
  return (
    <>
      <circle cx={x} cy={HEAD / 2} r={NAME_R} fill={ACCENT} />
      <text data-pwid="chord-piano-name" x={x} y={HEAD / 2} textAnchor="middle" dominantBaseline="central" fontSize={LABEL_FONT} fontWeight="bold" fill={INK}>
        {note.name}
      </text>
      {note.degree !== null && (
        <text data-pwid="chord-piano-degree" x={x} y={keyBottom - DEGREE_LIFT} textAnchor="middle" dominantBaseline="central" fontSize={DEGREE_FONT} fontWeight="bold" fill={INK}>
          {note.degree}
        </text>
      )}
    </>
  )
}

// The keyboard's measures in viewBox units; one em of chart text spans EM of them.
const EM = 20
const WHITE_W = 14
const WHITE_H = 52
const BLACK_W = 9
const BLACK_H = 32
const HEAD = 20 // the row of note-name circles above the keys
const NAME_R = 8
const LABEL_FONT = 8
const DEGREE_FONT = 7
const DEGREE_LIFT = 8 // from a key's bottom edge to its degree label's middle

// Fixed so the keys read as a piano on both themes; the accent's ink is dark in both.
const WHITE_KEY = "#f5f5f4"
const INK = "#1c1917"
const ACCENT = "#e69a28"
