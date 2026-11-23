import { useMemo, useReducer } from "react"
import { readTake, type TakeReading, BEATS_PER_BAR } from "gigbag.js/charts/take"
import { countInBeats } from "gigbag.js/click/click"
import { MicPicker } from "gigbag.js/click/controls"
import type { Take } from "gigbag.js/click/take"
import { MicMeter } from "gigbag.js/click/readouts"
import { useClickTrack } from "gigbag.js/click/use-click-track"
import { MIC, useStoredSetting } from "./stored-setting"
import { field } from "./ui/field"

/**
 * Records a take for a phrase (docs/adr/0013): plays the song's click, listens
 * on the chosen mic (the one the click's Listen uses), and on Stop writes the
 * rhythm of the notes as a slash staff with `onTex`. The audio stays in the
 * browser. After a take, the player can move it a 16th earlier or later, and
 * each move writes the phrase again.
 */
export function RecordTake({ bpm, onTex, className }: { bpm: number; onTex: (tex: string) => void; className: string }) {
  const [{ recording, shift }, dispatch] = useReducer(session, { recording: false, shift: 0 })
  const [micId, setMicId] = useStoredSetting(MIC)
  // The take reads its own 16th grid (`readTake`), so the click's subdivision only scores hits this form ignores.
  const { take, mics } = useClickTrack({ mode: recording ? "listen" : "off", bpm, beatsPerBar: BEATS_PER_BAR, subdivision: 4, micId })

  // The count-in's measured delay when the mic heard the click; otherwise the browser's estimate.
  const expectedDelayMs = take.latencyMs ?? take.reportedLatencyMs
  const reading = useMemo(
    () => (expectedDelayMs === null ? null : readTake(take.notesMs, { bpm, expectedDelayMs, shift })),
    [take.notesMs, bpm, expectedDelayMs, shift],
  )
  const write = (reading: TakeReading | null) => {
    if (reading?.tex) onTex(reading.tex)
  }
  const start = () => dispatch({ type: "start" })
  const stop = () => {
    dispatch({ type: "stop" })
    write(reading)
  }
  const move = (by: number) => {
    dispatch({ type: "move", by })
    write(expectedDelayMs === null ? null : readTake(take.notesMs, { bpm, expectedDelayMs, shift: shift + by }))
  }
  const done = !recording && take.device !== null

  return (
    <div data-pwid="phrase-record-panel" className="space-y-1 text-xs text-zinc-400">
      <div className="flex flex-wrap items-center gap-2">
        <button data-pwid="phrase-record" type="button" aria-pressed={recording} onClick={() => (recording ? stop() : start())} className={className}>
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
        {recording ? (
          <div className="w-24">
            <MicMeter peak={take.level} parts={MIC_METER_PARTS} />
          </div>
        ) : (
          <MicPicker
            mics={mics}
            micId={micId}
            onMic={setMicId}
            parts={{ root: { className: "flex items-center gap-2" }, select: { className: `${field({ size: "sm" })} max-w-48 cursor-pointer`, "data-pwid": "phrase-record-mic" } }}
          />
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
  if (!recording && take.device === null) return `Plays the click at the song's tempo and writes the rhythm you play. Play the click through speakers, so the mic can time it.`
  const notes = `${take.notesMs.length} ${take.notesMs.length === 1 ? "note" : "notes"}`
  if (recording) {
    if (take.device === null) return "Opening the microphone…"
    if (take.beat === null) return "Starting…"
    if (take.beat < COUNT_IN) return `Count-in ${take.beat + 1} of ${COUNT_IN}.`
    return `Bar ${Math.floor((take.beat - COUNT_IN) / BEATS_PER_BAR) + 1}: play, then press Stop. ${notes} so far.`
  }
  if (!reading?.tex) return "No notes were heard after the count-in."
  const estimated = take.missedClick ? " The mic did not hear the click, so the browser's delay estimate placed them: if the take reads a 16th off, move it." : ""
  const moved = shift === 0 ? "" : ` Moved ${Math.abs(shift)} 16th${Math.abs(shift) === 1 ? "" : "s"} ${shift < 0 ? "earlier" : "later"}.`
  const drifting = reading.driftingBars.map((b) => b.bar + 1)
  const check = drifting.length === 0 ? "" : ` ${drifting.length === 1 ? "Bar" : "Bars"} ${drifting.join(", ")} sit between 16ths: check ${drifting.length === 1 ? "it" : "them"}.`
  return `Heard ${notes}.${estimated}${moved}${check}`
}

type Session = { readonly recording: boolean; readonly shift: number }

/** A new take starts on the 16th the mic heard; a move applies only to the take it was made on. */
function session(state: Session, event: { type: "start" } | { type: "stop" } | { type: "move"; by: number }): Session {
  switch (event.type) {
    case "start":
      return { recording: true, shift: 0 }
    case "stop":
      return { ...state, recording: false }
    case "move":
      return { ...state, shift: state.shift + event.by }
  }
}

/** The beats before the first bar of a take. */
const COUNT_IN = countInBeats(BEATS_PER_BAR)

const MIC_METER_PARTS = {
  root: { className: "h-1.5 overflow-hidden rounded-full bg-zinc-800" },
  fill: { className: "h-full bg-zinc-400" },
}
