import { Suspense, lazy, useEffect, useRef, useState, type TouchEvent } from "react"
import { useRouter } from "@tanstack/react-router"
import { charts, type ChartInfo, type SetlistEntryInfo } from "~/api/client"
import { hasLyricsChart } from "~/charts/lyrics"
import { ChartViewToggle, chartsInView, type ChartView } from "./ChartViewToggle"
import type { NumeralDisplay } from "~/charts/numeral"
import type { ChordDiagrams } from "./ChordShapes"
import { ClickTrack } from "./ClickTrack"
import { useLive, type Room } from "./live"
import { Viewers } from "./Viewers"
import { formatDuration } from "./duration"
import { MarkedChart } from "./MarkedChart"
import { errorMessage } from "./form"
import { TEXT_SIZES, stepIndex, stepSize, swipeDirection } from "./perform"

const ScoreViewer = lazy(() => import("~/components/ScoreViewer").then((m) => ({ default: m.ScoreViewer })))

/** One song on stage, with the name of the set it belongs to when the show has more than one. */
export type StageSong = { readonly entry: SetlistEntryInfo; readonly set: string | null }

/** Pixels per second for each auto-scroll setting; 0 is off. */
const SCROLL_SPEEDS = [0, 15, 30, 60] as const

/**
 * The stage view: one song at a time, large and dark, with no site chrome. It
 * covers the whole window, so the navigation bar behind it is not reachable.
 */
export function PerformView({
  title,
  order,
  room,
  index,
  onShow,
  onExit,
  emptyText,
}: {
  title: string
  order: ReadonlyArray<StageSong>
  /** The live room: the others who have it open, and whom this page can follow. */
  room: Room
  /** The song on screen, 0-based, already held inside `order`. */
  index: number
  /** Shows the song at a 0-based index; the route keeps it in the URL. */
  onShow: (index: number) => void
  onExit: () => void
  emptyText: string
}) {
  const router = useRouter()
  const current = order[index]
  const upcoming = order[index + 1]
  const songCharts = useSongCharts(current?.entry.song_id ?? null)
  // A score draws no chord names, so a song without a lyrics chart gets neither control.
  const chordControls = songCharts.list !== null && hasLyricsChart(songCharts.list)

  const [sizeStep, setSizeStep] = useState(readSizeStep)
  const [speedStep, setSpeedStep] = useState(0)
  const [numeralDisplay, setNumeralDisplay] = useState<NumeralDisplay>("both")
  const [diagrams, setDiagrams] = useState<ChordDiagrams>("guitar")
  const [showChordsAbove, setShowChordsAbove] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  // The band member whose song this page follows; going to a song yourself stops that.
  const [following, setFollowing] = useState<string | null>(null)
  const { client, viewers } = useLive(room, { mode: "performing", at: index + 1 }, () => void router.invalidate())
  const leader = following === null ? undefined : viewers.find((v) => v.client === following)
  useEffect(() => {
    if (leader?.at != null && leader.at !== index + 1) onShow(stepIndex(leader.at - 1, 0, order.length))
  }, [leader?.at, index, onShow, order.length])
  useEffect(() => {
    if (following !== null && !leader && viewers.length > 0) setFollowing(null)
  }, [following, leader, viewers.length])

  const go = (delta: number) => {
    setFollowing(null)
    onShow(stepIndex(index, delta, order.length))
  }
  const resize = (delta: number) => {
    const next = stepSize(sizeStep, delta)
    setSizeStep(next)
    try {
      localStorage.setItem("perform-size", String(next))
    } catch {
      // Private mode or blocked storage: the size just is not remembered.
    }
  }

  // The latest handlers for the key listener, which is installed once.
  const keys = useRef({ go, resize, onExit })
  keys.current = { go, resize, onExit }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      const { go, resize, onExit } = keys.current
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") go(1)
      else if (event.key === "ArrowLeft" || event.key === "PageUp") go(-1)
      else if (event.key === "+" || event.key === "=") resize(1)
      else if (event.key === "-") resize(-1)
      else if (event.key === "Escape") onExit()
      else return
      event.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // A new song starts at the top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [index])

  // Auto-scroll: advance by elapsed time, so the speed does not depend on the frame rate.
  useEffect(() => {
    const speed = SCROLL_SPEEDS[speedStep]!
    if (speed === 0) return
    let frame = 0
    let last = performance.now()
    let carried = 0
    const tick = (now: number) => {
      carried += ((now - last) / 1000) * speed
      last = now
      const whole = Math.floor(carried)
      if (whole > 0 && scroller.current) {
        scroller.current.scrollTop += whole
        carried -= whole
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [speedStep])

  // Keep the screen awake while a song is being read from it.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock?.request("screen").then((l) => (lock = l), () => undefined)
    return () => void lock?.release().catch(() => undefined)
  }, [])

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null
  }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current
    const t = e.changedTouches[0]
    touchStart.current = null
    if (start && t) {
      const direction = swipeDirection(t.clientX - start.x, t.clientY - start.y)
      if (direction !== 0) go(direction)
    }
  }

  const size = TEXT_SIZES[sizeStep]!
  const button =
    "px-3 py-2 rounded-md border border-zinc-700 text-sm text-zinc-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"

  return (
    <div data-pwid="perform" className="[--stick-top:0px] fixed inset-0 z-50 flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span data-pwid="perform-setlist" className="truncate text-sm text-zinc-500">{title}</span>
          <Viewers viewers={viewers} me={client} following={following} onFollow={setFollowing} />
        </div>
        <div className="flex items-center gap-2">
          <button data-pwid="perform-smaller" type="button" aria-label="Smaller text" onClick={() => resize(-1)} disabled={sizeStep === 0} className={button}>A−</button>
          <button data-pwid="perform-larger" type="button" aria-label="Larger text" onClick={() => resize(1)} disabled={sizeStep === TEXT_SIZES.length - 1} className={button}>A+</button>
          {chordControls && (
            <>
              <select
                data-pwid="perform-diagrams"
                value={diagrams}
                onChange={(e) => setDiagrams(e.target.value as ChordDiagrams)}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 cursor-pointer"
                aria-label="Chord diagrams"
              >
                <option value="guitar">Guitar</option>
                <option value="staff">Staff</option>
                <option value="piano">Piano</option>
                <option value="off">Off</option>
              </select>
              <label className="flex items-center gap-1 text-sm text-zinc-200">
                <input
                  data-pwid="perform-show-chords-above"
                  type="checkbox"
                  checked={showChordsAbove}
                  disabled={diagrams === "off"}
                  onChange={(e) => setShowChordsAbove(e.target.checked)}
                />
                Show chords above the chart
              </label>
            </>
          )}
          <select
            data-pwid="perform-numeral-display"
            value={numeralDisplay}
            onChange={(e) => setNumeralDisplay(e.target.value as NumeralDisplay)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 cursor-pointer"
            aria-label="Chord display"
          >
            <option value="both">Names & numerals</option>
            <option value="names">Names only</option>
            <option value="numerals">Numerals only</option>
          </select>
          {current?.entry.tempo_bpm != null && (
            <ClickTrack key={current.entry.id} bpm={current.entry.tempo_bpm} pwid="perform-click" className={button} />
          )}
          <button data-pwid="perform-scroll" type="button" aria-pressed={speedStep > 0} onClick={() => setSpeedStep((speedStep + 1) % SCROLL_SPEEDS.length)} className={button}>
            {speedStep === 0 ? "Scroll off" : `Scroll ${"▸".repeat(speedStep)}`}
          </button>
          <button data-pwid="perform-exit" type="button" onClick={onExit} className={button}>
            Exit
          </button>
        </div>
      </header>

      {!current ? (
        <p data-pwid="perform-empty" className="m-auto text-zinc-500">{emptyText}</p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div
            ref={scroller}
            data-pwid="perform-scroller"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className="min-w-0 flex-1 overflow-y-auto px-5 py-4"
          >
            <div className="mb-4">
              {current.set && <div data-pwid="perform-section" className="text-sm font-semibold uppercase tracking-wide text-[var(--color-amber-accent)]">{current.set}</div>}
              <h1 data-pwid="perform-title" className="text-4xl font-bold tracking-tight">{current.entry.title}</h1>
              <p data-pwid="perform-meta" className="mt-1 text-xl text-zinc-400">
                {[
                  current.entry.key,
                  current.entry.tempo_bpm === null ? null : `${current.entry.tempo_bpm} BPM`,
                  current.entry.capo ? `capo ${current.entry.capo}` : null,
                  current.entry.duration_seconds === null ? null : formatDuration(current.entry.duration_seconds),
                ]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </p>
              {current.entry.notes && <p data-pwid="perform-notes" className="mt-2 whitespace-pre-wrap text-lg text-zinc-300">{current.entry.notes}</p>}
            </div>
            <SongCharts
              key={current.entry.song_id}
              list={songCharts.list}
              error={songCharts.error}
              shownKey={current.entry.key}
              tempo={current.entry.tempo_bpm}
              size={size}
              numeralDisplay={numeralDisplay}
              diagrams={diagrams}
              showChordsAbove={showChordsAbove}
            />
          </div>

          <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-zinc-800 p-3 md:block">
            <ol className="space-y-1">
              {order.map((item, i) => (
                <li key={item.entry.id}>
                  {item.set !== null && item.set !== order[i - 1]?.set && (
                    <div data-pwid="perform-set-heading" className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{item.set}</div>
                  )}
                  <button
                    data-pwid="perform-song"
                    data-current={i === index}
                    type="button"
                    onClick={() => {
                      setFollowing(null)
                      onShow(i)
                    }}
                    className={`w-full truncate rounded-md px-3 py-2 text-left text-sm cursor-pointer ${
                      i === index ? "bg-[var(--color-amber-accent)] font-semibold text-zinc-950" : "text-zinc-400 hover:bg-zinc-900"
                    }`}
                  >
                    {i + 1}. {item.entry.title}
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}

      <footer className="flex items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
        <button data-pwid="perform-prev" type="button" onClick={() => go(-1)} disabled={index === 0} className={button}>← Back</button>
        <div className="min-w-0 text-center">
          <div data-pwid="perform-position" className="text-sm text-zinc-300">{order.length === 0 ? "0 / 0" : `${index + 1} / ${order.length}`}</div>
          {upcoming && <div data-pwid="perform-next-title" className="truncate text-xs text-zinc-500">Next: {upcoming.entry.title}</div>}
        </div>
        <button data-pwid="perform-next" type="button" onClick={() => go(1)} disabled={index >= order.length - 1} className={button}>Next →</button>
      </footer>
    </div>
  )
}

/**
 * The charts of the song on stage. The header's chord controls ask about the
 * same list, so it is loaded once here and handed to both.
 */
function useSongCharts(songId: string | null) {
  const [loaded, setLoaded] = useState<{ songId: string; list: ReadonlyArray<ChartInfo> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (songId === null) return
    let current = true
    setError(null)
    charts.bySong(songId).then(
      (list) => current && setLoaded({ songId, list }),
      (e) => current && setError(errorMessage(e)),
    )
    return () => {
      current = false
    }
  }, [songId])
  // The list of the song being read, never the one left behind by another song.
  return { list: loaded?.songId === songId ? loaded.list : null, error }
}

/** The charts of one song, in the entry's key. A lyrics chart shows the player's own marks but cannot be marked up here. */
function SongCharts({
  list,
  error,
  shownKey,
  tempo,
  size,
  numeralDisplay,
  diagrams,
  showChordsAbove,
}: {
  list: ReadonlyArray<ChartInfo> | null
  error: string | null
  shownKey: string | null
  tempo: number | null
  size: number
  numeralDisplay: NumeralDisplay
  diagrams: ChordDiagrams
  showChordsAbove: boolean
}) {
  const [view, setView] = useState<ChartView>("chords")
  if (error) return <p data-pwid="perform-error" className="text-red-400">{error}</p>
  if (list === null) return <p className="text-zinc-500">Loading…</p>
  if (list.length === 0) return <p data-pwid="perform-no-chart" className="text-zinc-500">No chart for this song yet.</p>
  const scoreCharts = list.filter((chart) => chart.kind === "score")
  return (
    <div className="space-y-8">
      <ChartViewToggle list={list} view={view} onChange={setView} />
      {chartsInView(list, view).map((chart) =>
        chart.source !== null ? (
          <MarkedChart
            key={chart.id}
            chart={{ ...chart, source: chart.source }}
            shownKey={shownKey}
            tempo={tempo}
            toolbar={false}
            size={size}
            numeralDisplay={numeralDisplay}
            diagrams={diagrams}
            showChordsAbove={showChordsAbove}
            scoreCharts={scoreCharts}
          />
        ) : (
          <div key={chart.id} className="rounded-lg p-2">
            <Suspense fallback={<p className="text-zinc-500">Loading the score…</p>}>
              <ScoreViewer revisionId={chart.revision_id} />
            </Suspense>
          </div>
        ),
      )}
    </div>
  )
}

function readSizeStep(): number {
  try {
    const stored = Number(localStorage.getItem("perform-size"))
    return Number.isInteger(stored) ? stepSize(stored, 0) : 2
  } catch {
    return 2
  }
}
