import { useEffect, useMemo, type CSSProperties } from "react"
import { degrees } from "alphatab-kit/charts/degrees"
import { numeral } from "~/charts/numeral"
import { spell } from "alphatab-kit/charts/spelling"
import { voicings } from "alphatab-kit/charts/voicing"
import { writeFrets } from "alphatab-kit/charts/fretting"
import { ChordDiagram } from "./ChordDiagram"
import { ChordStaffBlock } from "./ChordStaff"
import { ChordPianoBlock } from "./PianoDiagram"
import { playChord, preloadChordPlayer } from "~/audio/chord"

/** Which chords of a chart show a diagram when tapped: guitar, staff, piano, or none. */
export type ChordDiagrams = "guitar" | "staff" | "piano" | "off"

/**
 * The shapes for one chord name: guitar diagrams, or the same chord as stacked
 * notes on a staff, or as pressed keys on a piano.
 *
 * A name the player cannot read, or one no hand can hold, has no shape: the
 * panel says so instead of showing nothing. Each guitar shape names the degree
 * of every note it sounds, open strings included, and the chord's Roman numeral
 * sits under its name when the chart is shown in a known key. With staff or
 * piano, the panel draws the chord's tones in place of the guitar diagrams; the name and
 * numeral lines stay. The row scrolls sideways when it is wider than the
 * screen, so a chord near the right edge still shows every shape. The panel is
 * drawn over the chart by the caller, and the diagrams take the chart's text
 * color, so they read on the light page and on stage.
 *
 * The prop is `shownKey`, not `key`: React takes a `key` prop for itself and
 * never hands it to a component.
 */
export function ChordShapes({
  name,
  shownKey,
  anchor,
  diagrams = "guitar",
}: {
  name: string
  shownKey: string | null
  anchor: string
  diagrams?: ChordDiagrams
}) {
  const chord = useMemo(() => {
    const spelled = spell(name)
    if (spelled === null) return null
    return { spelled, shapes: diagrams === "guitar" ? voicings(spelled) : null }
  }, [name, diagrams])
  const chordNumeral = numeral(name, shownKey)
  const label = `${name} on ${diagrams === "off" ? "guitar" : diagrams}`
  useEffect(() => {
    preloadChordPlayer()
  }, [])

  return (
    <div
      data-pwid="chord-shapes"
      role="dialog"
      aria-label={label}
      style={placement(anchor)}
      className="z-10 w-max rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 shadow-lg"
    >
      {diagrams === "staff" || diagrams === "piano" ? (
        chord === null ? (
          <div data-pwid="chord-shapes-none" className="text-xs">{`No notes for ${name}`}</div>
        ) : diagrams === "staff" ? (
          <ChordStaffBlock name={name} spelling={chord.spelled} shownKey={shownKey} />
        ) : (
          <ChordPianoBlock name={name} spelling={chord.spelled} shownKey={shownKey} />
        )
      ) : chord === null || chord.shapes === null || chord.shapes.length === 0 ? (
        <div data-pwid="chord-shapes-none" className="text-xs">{`No guitar shape for ${name}`}</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto">
          {chord.shapes.map((shape, index) => (
            <ChordDiagram
              key={writeFrets(shape.frets)}
              frets={shape.frets}
              name={index === 0 ? name : undefined}
              numeral={index === 0 ? (chordNumeral ?? undefined) : undefined}
              labels={degrees(chord.spelled, shape)}
              onClick={() => void playChord(shape.frets)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Places the panel under its chord with CSS anchor positioning. It is fixed to the
 * viewport, so a chord near the right edge flips the panel to the left instead of
 * widening the page, and a panel wider than the screen scrolls within itself.
 */
/** Places a fixed panel under the element named `anchor`, flipped sideways when it would leave the window. */
export function placement(anchor: string): CSSProperties {
  return {
    position: "fixed",
    positionAnchor: anchor,
    positionArea: "bottom span-right",
    positionTryFallbacks: "flip-inline",
    maxWidth: "calc(100vw - 2rem)",
    margin: 4,
  } as CSSProperties
}
