import { useMemo, type CSSProperties } from "react"
import { degrees } from "~/charts/degrees"
import { numeral } from "~/charts/numeral"
import { spell } from "~/charts/spelling"
import { voicings } from "~/charts/voicing"
import { writeFrets } from "~/charts/fretting"
import { ChordDiagram } from "./ChordDiagram"
import { ChordStaff } from "./ChordStaff"

/** Which chords of a chart show a diagram when tapped: guitar, staff, or none. */
export type ChordDiagrams = "guitar" | "staff" | "off"

/**
 * The shapes for one chord name: guitar diagrams, or the same chord as stacked
 * notes on a staff.
 *
 * A name the player cannot read, or one no hand can hold, has no shape: the
 * panel says so instead of showing nothing. Each guitar shape names the degree
 * of every note it sounds, open strings included, and the chord's Roman numeral
 * sits under its name when the chart is shown in a known key. With staff, the
 * panel draws the chord's tones in place of the guitar diagrams; the name and
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
  const label = diagrams === "staff" ? `${name} on staff` : `${name} on guitar`

  return (
    <div
      data-pwid="chord-shapes"
      role="dialog"
      aria-label={label}
      style={placement(anchor)}
      className="z-10 w-max rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 shadow-lg"
    >
      {diagrams === "staff" ? (
        chord === null ? (
          <div data-pwid="chord-shapes-none" className="text-xs">{`No notes for ${name}`}</div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="text-center text-sm font-semibold">{name}</div>
            {chordNumeral !== null && (
              <div data-pwid="shapes-numeral" className="text-center text-xs text-zinc-500">
                {chordNumeral}
              </div>
            )}
            <ChordStaff spelling={chord.spelled} />
          </div>
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
function placement(anchor: string): CSSProperties {
  return {
    position: "fixed",
    positionAnchor: anchor,
    positionArea: "bottom span-right",
    positionTryFallbacks: "flip-inline",
    maxWidth: "calc(100vw - 2rem)",
    margin: 4,
  } as CSSProperties
}
