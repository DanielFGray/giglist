import { Effect, Fiber, Stream } from "effect"
import { useEffect, useMemo, useState } from "react"
import { BEATS_PER_BAR, COUNT_IN_BEATS } from "~/audio/click/click"
import { clickTrack } from "~/audio/click/engine"
import { readTake, type TakeReading } from "~/charts/take"
import { meterFill, NEW_TAKE, type Take, takeStep } from "./click-take"

/**
 * Records a take for a phrase (docs/adr/0013): plays the song's click, listens
 * on the mic, and on Stop writes the rhythm of the notes as a slash staff with
 * `onTex`. The audio stays in the browser. After a take, the player can move
 * it a 16th earlier or later, and each move writes the phrase again.
 */
export function RecordTake({ bpm, onTex, className }: { bpm: number; onTex: (tex: string) => void; className: string }) {
  const [recording, setRecording] = useState(false)
  const [take, setTake] = useState<Take>(NEW_TAKE)
  const [shift, setShift] = useState(0)

  useEffect(() => {
    if (!recording) return
    setTake(NEW_TAKE)
    setShift(0)
    const fiber = Effect.runFork(Stream.runForEach(clickTrack({ bpm, listen: true }), (event) => Effect.sync(() => setTake((take) => takeStep(take, event)))))
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, [recording, bpm])

  // The count-in's measured delay when the mic heard the click; with headphones, the browser's estimate.
  const expectedDelayMs = take.latencyMs ?? take.reportedLatencyMs
  const reading = useMemo(
    () => (expectedDelayMs === null ? null : readTake(take.notesMs, { bpm, expectedDelayMs, shift })),
    [take.notesMs, bpm, expectedDelayMs, shift],
  )
  const write = (reading: TakeReading | null) => {
    if (reading?.tex) onTex(reading.tex)
  }
  const stop = () => {
    setRecording(false)
    write(reading)
  }
  const move = (by: number) => {
    setShift(shift + by)
    write(expectedDelayMs === null ? null : readTake(take.notesMs, { bpm, expectedDelayMs, shift: shift + by }))
  }
  const fill = Math.round(meterFill(take.level) * 100)
  const done = !recording && take.device !== null

  return (
    <div data-pwid="phrase-record-panel" className="space-y-1 text-xs text-zinc-400">
      <div className="flex flex-wrap items-center gap-2">
        <button data-pwid="phrase-record" type="button" aria-pressed={recording} onClick={() => (recording ? stop() : setRecording(true))} className={className}>
          {recording ? "Stop" : done ? "Record again" : "Record a take"}
        </button>
        {done && reading?.tex && (
          <>
            <button data-pwid="phrase-shift-earlier" type="button" onClick={() => move(-1)} className={className}>
              16th earlier
            </button>
            <button data-pwid="phrase-shift-later" type="button" onClick={() => move(1)} className={className}>
              16th later
            </button>
          </>
        )}
        {recording && (
          <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-zinc-400" style={{ width: `${fill}%` }} />
          </div>
        )}
      </div>
      <p data-pwid="phrase-record-status" aria-live="polite">
        {recordStatus(take, recording, reading, shift)}
      </p>
    </div>
  )
}

/** One line on what the player should do now, or what the take read. */
function recordStatus(take: Take, recording: boolean, reading: TakeReading | null, shift: number): string {
  if (take.failure !== null) return take.failure
  if (!recording && take.device === null) return `Plays the click at the song's tempo and writes the rhythm you play. Headphones work best.`
  if (take.device === null) return "Opening the microphone…"
  if (take.beat === null) return "Starting…"
  if (recording && take.beat < COUNT_IN_BEATS) return `Count-in ${take.beat + 1} of ${COUNT_IN_BEATS}.`
  const notes = `${take.notesMs.length} ${take.notesMs.length === 1 ? "note" : "notes"}`
  if (recording) return `Bar ${Math.floor((take.beat - COUNT_IN_BEATS) / BEATS_PER_BAR) + 1}: play, then press Stop. ${notes} so far.`
  if (!reading?.tex) return "No notes were heard after the count-in."
  const estimated = take.missedClick ? " The mic did not hear the click, so the browser's delay estimate placed them: if the take reads a 16th off, move it." : ""
  const moved = shift === 0 ? "" : ` Moved ${Math.abs(shift)} 16th${Math.abs(shift) === 1 ? "" : "s"} ${shift < 0 ? "earlier" : "later"}.`
  const drifting = reading.driftingBars.map((b) => b.bar + 1)
  const check = drifting.length === 0 ? "" : ` ${drifting.length === 1 ? "Bar" : "Bars"} ${drifting.join(", ")} sit between 16ths: check ${drifting.length === 1 ? "it" : "them"}.`
  return `Heard ${notes}.${estimated}${moved}${check}`
}
