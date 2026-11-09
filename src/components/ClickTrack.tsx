import { Effect, Fiber, Stream } from "effect"
import { useEffect, useState } from "react"
import { BEATS_PER_BAR } from "~/audio/click/click"
import { clickTrack } from "~/audio/click/engine"

/**
 * A button that plays a click at `bpm`, with the first beat of each bar
 * accented. It stops when pressed again, when the tempo changes, or when the
 * page leaves.
 */
export function ClickTrack({ bpm, className, pwid = "click" }: { bpm: number; className: string; pwid?: string }) {
  const [playing, setPlaying] = useState(false)
  const [beat, setBeat] = useState<number | null>(null)

  useEffect(() => {
    if (!playing) return
    const fiber = Effect.runFork(
      Stream.runForEach(clickTrack({ bpm, listen: false }), (event) =>
        Effect.sync(() => {
          if (event._tag === "Beat") setBeat(event.beat)
        }),
      ),
    )
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
      setBeat(null)
    }
  }, [playing, bpm])

  return (
    <button
      data-pwid={pwid}
      data-beat={beat ?? undefined}
      type="button"
      aria-pressed={playing}
      onClick={() => setPlaying(!playing)}
      className={className}
    >
      {playing ? `Click ${bpm}${beat !== null ? ` · ${(beat % BEATS_PER_BAR) + 1}` : ""}` : "Click"}
    </button>
  )
}
