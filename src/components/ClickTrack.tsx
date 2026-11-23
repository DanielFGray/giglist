import { useReducer, useState } from "react"
import { BEATS_PER_BAR } from "gigbag.js/charts/take"
import { MicPicker, SubdivisionSelect } from "gigbag.js/click/controls"
import { MicMeter, OffsetChart, TakeSummary } from "gigbag.js/click/readouts"
import { judgement, signedMs, takeStatus } from "gigbag.js/click/report"
import type { Take } from "gigbag.js/click/take"
import type { Hit, Subdivision } from "gigbag.js/click/timing"
import { type ClickMode as Mode, type Mic, useClickTrack } from "gigbag.js/click/use-click-track"
import { useMicChoice } from "./mic-choice"
import { field } from "./ui/field"

/**
 * Two buttons that play a click at `bpm`, with the first beat of each bar
 * accented. Click only plays it. Listen also opens the chosen mic and times
 * each note against the click, in a panel under the buttons that stays open
 * after the take stops, until it is closed or the next take starts. The panel
 * draws every note of the take early or late, sums the take up, and picks the
 * grid the notes aim at and the mic. The click stops when its button is
 * pressed again, when the tempo changes, or when the page leaves.
 */
export function ClickTrack({ bpm, className, pwid = "click" }: { bpm: number; className: string; pwid?: string }) {
  const [{ mode, panel }, dispatch] = useReducer(buttons, { mode: "off", panel: false })
  const [subdivision, setSubdivision] = useState<Subdivision>(1)
  const [micId, setMicId] = useMicChoice()
  const { take, hits, mics } = useClickTrack({ mode, bpm, beatsPerBar: BEATS_PER_BAR, subdivision, micId })
  const toggle = (button: Exclude<Mode, "off">) => dispatch({ type: "press", button })
  const close = () => dispatch({ type: "close" })
  const counter = take.beat === null ? "" : ` · ${(take.beat % BEATS_PER_BAR) + 1}`

  // Not the kit's ClickButton: its parts cannot carry aria-expanded, which Listen needs for its panel.
  return (
    <div className="relative flex gap-2">
      <button data-pwid={pwid} data-beat={mode === "click" ? (take.beat ?? undefined) : undefined} type="button" aria-pressed={mode === "click"} onClick={() => toggle("click")} className={className}>
        {mode === "click" ? `Click ${bpm}${counter}` : "Click"}
      </button>
      <button
        data-pwid={`${pwid}-listen`}
        data-beat={mode === "listen" ? (take.beat ?? undefined) : undefined}
        type="button"
        aria-pressed={mode === "listen"}
        aria-expanded={panel}
        onClick={() => toggle("listen")}
        className={className}
      >
        {mode === "listen" ? `Listen ${bpm}${counter}` : "Listen"}
      </button>
      {panel && (
        <ListenPanel
          take={take}
          hits={hits}
          running={mode === "listen"}
          subdivision={subdivision}
          onSubdivision={setSubdivision}
          mics={mics}
          micId={micId}
          onMic={setMicId}
          onClose={close}
          pwid={pwid}
        />
      )}
    </div>
  )
}

type Buttons = { readonly mode: Mode; readonly panel: boolean }

/**
 * A press on the button that is on turns it off and leaves the panel as it is,
 * so a take's result stays readable after Listen stops. A press on the other
 * button turns it on: Listen opens the panel, Click closes it. Close shuts the
 * panel and stops a take, but not a plain click.
 */
function buttons(state: Buttons, event: { type: "press"; button: Exclude<Mode, "off"> } | { type: "close" }): Buttons {
  if (event.type === "close") return { mode: state.mode === "listen" ? "off" : state.mode, panel: false }
  if (state.mode === event.button) return { ...state, mode: "off" }
  return { mode: event.button, panel: event.button === "listen" }
}

function ListenPanel({
  take,
  hits,
  running,
  subdivision,
  onSubdivision,
  mics,
  micId,
  onMic,
  onClose,
  pwid,
}: {
  take: Take
  hits: ReadonlyArray<Hit>
  running: boolean
  subdivision: Subdivision
  onSubdivision: (subdivision: Subdivision) => void
  mics: ReadonlyArray<Mic>
  micId: string | null
  onMic: (micId: string | null) => void
  onClose: () => void
  pwid: string
}) {
  const last = hits.at(-1)
  // The panel is a stage (app.css): dark in both themes, because it also opens
  // over the dark stage view. On a phone it is a sheet at the bottom of the screen.
  return (
    <section
      data-pwid={`${pwid}-panel`}
      aria-label="Timing"
      className="stage fixed inset-x-4 bottom-4 z-40 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 space-y-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-200 shadow-xl"
    >
      <div className="flex items-start justify-between gap-3">
        <p data-pwid={`${pwid}-status`} aria-live="polite" className="text-zinc-200">
          {takeStatus(take, running, BEATS_PER_BAR)}
        </p>
        <button type="button" data-pwid={`${pwid}-close`} onClick={onClose} aria-label="Close" className="shrink-0 cursor-pointer px-1 text-zinc-500 hover:text-zinc-100">
          ✕
        </button>
      </div>
      {running && (
        <div className="space-y-1">
          <p className="truncate text-xs text-zinc-500">{take.device === null ? "Opening the microphone…" : `Listening on ${take.device}`}</p>
          <MicMeter peak={take.level} parts={MIC_METER_PARTS} />
        </div>
      )}
      <div aria-live="polite" className="text-center">
        <p data-pwid={`${pwid}-last`} className={`text-3xl font-semibold tabular-nums ${last === undefined ? "text-zinc-600" : ""}`}>
          {last === undefined ? "—" : signedMs(last.offsetMs)}
        </p>
        <p className="text-xs text-zinc-500">{last === undefined ? "Your last note shows here" : judgement(last.offsetMs)}</p>
      </div>
      {hits.length > 0 && <OffsetChart hits={hits} height={96} parts={{ root: { className: "text-zinc-300", "data-pwid": `${pwid}-chart` } }} />}
      <TakeSummary hits={hits} parts={SUMMARY_PARTS} />
      <div className="space-y-2">
        <SubdivisionSelect subdivision={subdivision} onSubdivision={onSubdivision} parts={pickerParts(`${pwid}-subdivision`)} />
        <MicPicker mics={mics} micId={micId} onMic={onMic} parts={pickerParts(`${pwid}-mic`)} />
      </div>
    </section>
  )
}

const MIC_METER_PARTS = {
  root: { className: "h-1.5 overflow-hidden rounded-full bg-zinc-800" },
  fill: { className: "h-full bg-zinc-400" },
}

const SUMMARY_PARTS = {
  root: { className: "grid grid-cols-2 gap-2" },
  item: { className: "rounded-md bg-zinc-800/60 px-2 py-1.5" },
  label: { className: "text-xs text-zinc-500" },
  value: { className: "tabular-nums" },
}

/** A labelled select in the panel: the label left, the select right. */
const pickerParts = (pwid: string) => ({
  root: { className: "flex items-center justify-between gap-2 text-xs text-zinc-500" },
  select: { className: `${field({ size: "md" })} min-w-0 max-w-[65%] cursor-pointer`, "data-pwid": pwid },
})
