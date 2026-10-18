import { useMemo, type CSSProperties } from "react"
import { degrees } from "~/charts/degrees"
import { numeral } from "~/charts/numeral"
import { spell } from "~/charts/spelling"
import { voicings } from "~/charts/voicing"
import { writeFrets } from "~/charts/fretting"
import { ChordDiagram } from "./ChordDiagram"

/** Which chords of a chart show a guitar diagram when tapped: guitar, or none. */
export type ChordDiagrams = "guitar" | "off"

/**
 * The guitar shapes for one chord name, best first, as chord diagrams.
 *
 * A name the player cannot read, or one no hand can hold, has no shape: the
 * panel says so instead of showing nothing. Each shape names the degree of every
 * note it sounds, open strings included, and the chord's Roman numeral sits under
 * its name when the chart is shown in a known key. The row scrolls sideways when
 * it is wider than the screen, so a chord near the right edge still shows every
 * shape. The panel is drawn over the chart by the caller, and the diagrams take
 * the chart's text color, so they read on the light page and on stage.
 *
 * The prop is `shownKey`, not `key`: React takes a `key` prop for itself and
 * never hands it to a component.
 */
export function ChordShapes({ name, shownKey, anchor }: { name: string; shownKey: string | null; anchor: string }) {
  const chord = useMemo(() => {
    const spelled = spell(name)
    return spelled === null ? null : { spelled, shapes: voicings(spelled) }
  }, [name])
  const chordNumeral = numeral(name, shownKey)

  return (
    <div
      data-pwid="chord-shapes"
      role="dialog"
      aria-label={`${name} on guitar`}
      style={placement(anchor)}
      className="z-10 w-max rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 shadow-lg"
    >
      {chord === null || chord.shapes.length === 0 ? (
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
