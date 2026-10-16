import { useMemo } from "react"
import { spell } from "~/charts/spelling"
import { voicings } from "~/charts/voicing"
import { writeFrets } from "~/charts/fretting"
import { ChordDiagram } from "./ChordDiagram"

/**
 * The guitar shapes for one chord name, best first, as chord diagrams.
 *
 * A name the player cannot read, or one no hand can hold, has no shape: the
 * panel says so instead of showing nothing. The row scrolls sideways when it
 * is wider than the screen, so a chord near the right edge still shows every
 * shape. The panel is drawn over the chart by the caller, and the diagrams
 * take the chart's text color, so they read on the light page and on stage.
 */
export function ChordShapes({ name }: { name: string }) {
  const shapes = useMemo(() => {
    const spelled = spell(name)
    return spelled === null ? [] : voicings(spelled)
  }, [name])

  return (
    <div
      data-pwid="chord-shapes"
      role="dialog"
      aria-label={`${name} on guitar`}
      className="absolute top-full left-0 z-10 mt-1 w-max max-w-[min(36rem,calc(100vw-2rem))] rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-2 shadow-lg"
    >
      {shapes.length === 0 ? (
        <div data-pwid="chord-shapes-none" className="text-xs">{`No guitar shape for ${name}`}</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto">
          {shapes.map((shape, index) => (
            <ChordDiagram
              key={writeFrets(shape.frets)}
              frets={shape.frets}
              name={index === 0 ? name : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}