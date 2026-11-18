import { useState } from "react"
import { BEATS_PER_BAR } from "gigbag.js/charts/take"
import { MicMeter } from "gigbag.js/click/readouts"
import { hitTiles, judgement, signedMs, takeStatus } from "gigbag.js/click/report"
import type { Take } from "gigbag.js/click/take"
import type { Hit, Subdivision } from "gigbag.js/click/timing"
import { type ClickMode as Mode, useClickTrack } from "gigbag.js/click/use-click-track"

/** The grid the player aims at, for the subdivision picker. */
const SUBDIVISIONS: ReadonlyArray<readonly [Subdivision, string]> = [
  [1, "Quarter notes"],
  [2, "Eighth notes"],
  [3, "Triplets"],
  [4, "Sixteenths"],
]

const MIC_METER_PARTS = {
  root: { className: "h-1.5 overflow-hidden rounded-full bg-zinc-800" },
  fill: { className: "h-full bg-zinc-400" },
}

/**
 * Two buttons that play a click at `bpm`, with the first beat of each bar
 * accented. Click only plays it. Listen also opens the mic and times each
 * note against the click, in a panel under the buttons that stays open after
 * the take stops, until it is closed or the next take starts. The click stops
 * when its button is pressed again, when the tempo changes, or when the page
 * leaves.
 */
export function ClickTrack({ bpm, className, pwid = "click" }: { bpm: number; className: string; pwid?: string }) {
  const [mode, setMode] = useState<Mode>("off")
  const [panel, setPanel] = useState(false)
  const [subdivision, setSubdivision] = useState<Subdivision>(1)
  const { take, hits } = useClickTrack({ mode, bpm, beatsPerBar: BEATS_PER_BAR, subdivision, micId: null })

  const toggle = (pressed: Exclude<Mode, "off">) => {
    setMode(mode === pressed ? "off" : pressed)
    if (pressed === "listen" && mode !== "listen") setPanel(true)
    if (pressed === "click" && mode !== "click") setPanel(false)
  }
  const close = () => {
    setPanel(false)
    if (mode === "listen") setMode("off")
  }
  const counter = take.beat === null ? "" : ` · ${(take.beat % BEATS_PER_BAR) + 1}`

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
      {panel && <ListenPanel take={take} hits={hits} running={mode === "listen"} subdivision={subdivision} onSubdivision={setSubdivision} onClose={close} pwid={pwid} />}
    </div>
  )
}

function ListenPanel({
  take,
  hits,
  running,
  subdivision,
  onSubdivision,
  onClose,
  pwid,
}: {
  take: Take
  hits: ReadonlyArray<Hit>
  running: boolean
  subdivision: Subdivision
  onSubdivision: (subdivision: Subdivision) => void
  onClose: () => void
  pwid: string
}) {
  const last = hits.at(-1)
  // The panel is dark in both themes, because it also opens over the dark
  // stage view. So its text uses only grey shades that the light theme does
  // not remap (app.css). On a phone it is a sheet at the bottom of the screen.
  return (
    <section
      data-pwid={`${pwid}-panel`}
      aria-label="Timing"
      className="fixed inset-x-4 bottom-4 z-40 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 space-y-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-200 shadow-xl"
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
      <dl className="grid grid-cols-2 gap-2">
        {hitTiles(hits).map(([label, value]) => (
          <div key={label} className="rounded-md bg-zinc-800/60 px-2 py-1.5">
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <label className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        Notes aim at
        <select
          data-pwid={`${pwid}-subdivision`}
          value={subdivision}
          onChange={(e) => onSubdivision(SUBDIVISIONS.find(([value]) => String(value) === e.target.value)?.[0] ?? 1)}
          className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200"
        >
          {SUBDIVISIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}
