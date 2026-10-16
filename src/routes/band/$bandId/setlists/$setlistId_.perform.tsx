import { Suspense, lazy, useEffect, useRef, useState, type TouchEvent } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { charts, setlists, type ChartInfo } from "~/api/client"
import { groupEntries, playOrder } from "~/components/arrangement"
import { ClickTrack } from "~/components/ClickTrack"
import { useSetlistLive } from "~/components/live"
import { Viewers } from "~/components/Viewers"
import { formatDuration } from "~/components/duration"
import { MarkedChart } from "~/components/MarkedChart"
import { TEXT_SIZES, indexFromSearch, stepIndex, stepSize, swipeDirection } from "~/components/perform"

const ScoreViewer = lazy(() => import("~/components/ScoreViewer").then((m) => ({ default: m.ScoreViewer })))

export const Route = createFileRoute("/band/$bandId/setlists/$setlistId_/perform")({
  // `at` is the 1-based number of the song on screen, so the URL is the whole state of the stage view.
  validateSearch: (search: Record<string, unknown>): { at?: number } => {
    const at = Number(search.at)
    return Number.isInteger(at) && at > 0 ? { at } : {}
  },
  loader: async ({ params }) => {
    const [setlist, entries, sections] = await Promise.all([
      setlists.get(params.setlistId),
      setlists.entries(params.setlistId),
      setlists.sections(params.setlistId),
    ])
    return { setlist, order: playOrder(groupEntries(sections, entries)) }
  },
  component: Perform,
})

/** Pixels per second for each auto-scroll setting; 0 is off. */
const SCROLL_SPEEDS = [0, 15, 30, 60] as const

/**
 * The stage view: one song at a time, large and dark, with no site chrome. It
 * covers the whole window, so the navigation bar behind it is not reachable.
 */
function Perform() {
  const { bandId, setlistId } = Route.useParams()
  const { setlist, order } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()

  const index = indexFromSearch(search.at, order.length)
  const current = order[index]
  const upcoming = order[index + 1]

  const [sizeStep, setSizeStep] = useState(readSizeStep)
  const [speedStep, setSpeedStep] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  // The band member whose song this page follows; going to a song yourself stops that.
  const [following, setFollowing] = useState<string | null>(null)
  const { client, viewers } = useSetlistLive(setlistId, { mode: "performing", at: index + 1 }, () => void router.invalidate())
  const leader = following === null ? undefined : viewers.find((v) => v.client === following)
  useEffect(() => {
    if (leader?.at != null && leader.at !== index + 1) void navigate({ search: { at: leader.at }, replace: true })
  }, [leader?.at, index, navigate])
  useEffect(() => {
    if (following !== null && !leader && viewers.length > 0) setFollowing(null)
  }, [following, leader, viewers.length])

  const go = (delta: number) => {
    setFollowing(null)
    void navigate({ search: { at: stepIndex(index, delta, order.length) + 1 }, replace: true })
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
  const keys = useRef({ go, resize })
  keys.current = { go, resize }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      const { go, resize } = keys.current
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") go(1)
      else if (event.key === "ArrowLeft" || event.key === "PageUp") go(-1)
      else if (event.key === "+" || event.key === "=") resize(1)
      else if (event.key === "-") resize(-1)
      else if (event.key === "Escape") void navigate({ to: "/band/$bandId/setlists/$setlistId", params: { bandId, setlistId } })
      else return
      event.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate, bandId, setlistId])

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
    <div data-pwid="perform" className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span data-pwid="perform-setlist" className="truncate text-sm text-zinc-500">{setlist.name}</span>
          <Viewers viewers={viewers} me={client} following={following} onFollow={setFollowing} />
        </div>
        <div className="flex items-center gap-2">
          <button data-pwid="perform-smaller" type="button" aria-label="Smaller text" onClick={() => resize(-1)} disabled={sizeStep === 0} className={button}>A−</button>
          <button data-pwid="perform-larger" type="button" aria-label="Larger text" onClick={() => resize(1)} disabled={sizeStep === TEXT_SIZES.length - 1} className={button}>A+</button>
          {current?.entry.tempo_bpm != null && (
            <ClickTrack key={current.entry.id} bpm={current.entry.tempo_bpm} pwid="perform-click" className={button} />
          )}
          <button data-pwid="perform-scroll" type="button" aria-pressed={speedStep > 0} onClick={() => setSpeedStep((speedStep + 1) % SCROLL_SPEEDS.length)} className={button}>
            {speedStep === 0 ? "Scroll off" : `Scroll ${"▸".repeat(speedStep)}`}
          </button>
          <Link data-pwid="perform-exit" to="/band/$bandId/setlists/$setlistId" params={{ bandId, setlistId }} className={button}>
            Exit
          </Link>
        </div>
      </header>

      {!current ? (
        <p data-pwid="perform-empty" className="m-auto text-zinc-500">This setlist has no songs yet.</p>
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
              {current.section && <div data-pwid="perform-section" className="text-sm font-semibold uppercase tracking-wide text-[var(--color-amber-accent)]">{current.section}</div>}
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
              songId={current.entry.song_id}
              shownKey={current.entry.key}
              tempo={current.entry.tempo_bpm}
              size={size}
            />
          </div>

          <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-zinc-800 p-3 md:block">
            <ol className="space-y-1">
              {order.map((item, i) => (
                <li key={item.entry.id}>
                  <button
                    data-pwid="perform-song"
                    data-current={i === index}
                    type="button"
                    onClick={() => {
                      setFollowing(null)
                      void navigate({ search: { at: i + 1 }, replace: true })
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

/** The charts of one song, in the entry's key. A lyrics chart shows the player's own marks but cannot be marked up here. */
function SongCharts({ songId, shownKey, tempo, size }: { songId: string; shownKey: string | null; tempo: number | null; size: number }) {
  const [list, setList] = useState<ReadonlyArray<ChartInfo> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    charts.bySong(songId).then(
      (loaded) => current && setList(loaded),
      (e) => current && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      current = false
    }
  }, [songId])

  if (error) return <p data-pwid="perform-error" className="text-red-400">{error}</p>
  if (list === null) return <p className="text-zinc-500">Loading…</p>
  if (list.length === 0) return <p data-pwid="perform-no-chart" className="text-zinc-500">No chart for this song yet.</p>
  return (
    <div className="space-y-8">
      {list.map((chart) =>
        chart.source !== null ? (
          <MarkedChart key={chart.id} chart={{ ...chart, source: chart.source }} shownKey={shownKey} tempo={tempo} toolbar={false} size={size} />
        ) : (
          <div key={chart.id} className="rounded-lg bg-white p-2">
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
