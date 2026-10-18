import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { marks as marksApi, stamps as stampsApi, type ChartInfo, type ChartMarksInfo, type MarkData, type MarkInfo, type StampInfo } from "~/api/client"
import { boundsOf, inkPath, markResolver, near, type Box, type Stroke } from "~/charts/marks"
import { renderLyrics, chartChords } from "~/charts/lyrics"
import type { Resolution } from "~/charts/follow"
import type { NumeralDisplay } from "~/charts/numeral"
import { useAuth } from "./AuthContext"
import type { ChordDiagrams } from "./ChordShapes"
import { ChordStrip } from "./ChordStrip"
import { LyricsChart } from "./LyricsChart"
import { errorMessage } from "./form"

type Tool = "read" | "move" | "ink" | "text" | "stamp"
type Point = { x: number; y: number }
type Body = MarkInfo["body"]
type Placement = Pick<MarkData, "range_start" | "range_end" | "side" | "dx" | "dy" | "scale">

// The tools of annotate mode. Read is not a button: it is the state when no tool is armed or annotate is off.
const TOOLS: ReadonlyArray<{ tool: Tool; label: string }> = [
  { tool: "move", label: "Move" },
  { tool: "ink", label: "Ink" },
  { tool: "text", label: "Text" },
  { tool: "stamp", label: "Stamp" },
]

const buttonClass =
  "px-3 py-1.5 rounded-md border border-[var(--color-border-subtle)] text-xs text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"

/**
 * A lyrics chart with a player's marks over it: ink, text and stamps.
 *
 * A mark is anchored to a range of the chart's text, never to page position
 * (docs/adr/0001). Its place on screen is the anchored item's position plus an
 * offset in em, so it follows the item through transposition, resizing and
 * edits. A mark whose content was deleted waits in the tray.
 */
export function MarkedChart({
  chart,
  shownKey,
  tempo = null,
  toolbar = true,
  annotating = false,
  size,
  numeralDisplay = "both",
  diagrams = "guitar",
  showChordsAbove,
  scoreCharts,
}: {
  chart: ChartInfo & { source: string }
  shownKey: string | null
  /** The song's tempo, which phrases play at. */
  tempo?: number | null
  /** False on stage: the player's marks show, but nothing can be drawn, moved or shared. */
  toolbar?: boolean
  /** True while the player is annotating: the mark tools show, and a chord opens no shapes. */
  annotating?: boolean
  /** Text size in rem; see LyricsChart. */
  size?: number
  /** What to show for each chord: its name, its Roman numeral, or both. Default: both. */
  numeralDisplay?: NumeralDisplay
  /** Which chords show a diagram when tapped. Default: guitar. */
  diagrams?: ChordDiagrams
  /** Whether the strip of every chord shows above the chart. */
  showChordsAbove: boolean
  /** The latest revision of each score chart in the song, for score links. */
  /** The song's score charts, which score links in the chart draw from. */
  scoreCharts: ReadonlyArray<ChartInfo>
}) {
  const me = useAuth().user?.id
  const [data, setData] = useState<ChartMarksInfo>({ marks: [], revisions: [] })
  const [stampList, setStampList] = useState<ReadonlyArray<StampInfo>>([])
  const [tool, setTool] = useState<Tool>("read")
  // Leaving annotate mode disarms any tool, so the chart reads as before.
  useEffect(() => {
    if (!annotating) setTool("read")
  }, [annotating])
  const [text, setText] = useState("")
  const [stampId, setStampId] = useState("")
  const [stampName, setStampName] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [em, setEm] = useState(14)
  const [placed, setPlaced] = useState<ReadonlyMap<string, Point>>(new Map())
  const [preview, setPreview] = useState<Stroke | null>(null)

  const frame = useRef<HTMLDivElement>(null)
  // The ink mark that strokes drawn close together are still adding to.
  const inkDraft = useRef<{ markId: string; strokes: Array<Stroke> } | null>(null)
  // Writes run one after another, so a stroke drawn while the last one saves joins it.
  const writes = useRef<Promise<unknown>>(Promise.resolve())

  const reload = useCallback(async () => {
    try {
      const [loaded, loadedStamps] = await Promise.all([marksApi.byChart(chart.id), stampsApi.list()])
      setData(loaded)
      setStampList(loadedStamps)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [chart.id])

  useEffect(() => {
    void reload()
  }, [reload, chart.revision_id])

  const write = useCallback(
    (action: () => Promise<unknown>) => {
      const next = writes.current.then(action).then(reload, (e) => setError(errorMessage(e)))
      writes.current = next
      return next
    },
    [reload],
  )

  const resolved = useMemo(() => {
    const resolve = markResolver(data.revisions)
    return data.marks.map((mark) => ({ mark, resolution: resolve(mark) }))
  }, [data])

  // Read here, not from LyricsChart's lines: the strip sits above the frame whose
  // boxes marks are measured in, so showing it never moves a mark.
  const chords = useMemo(() => chartChords(renderLyrics(chart.source, shownKey)), [chart.source, shownKey])

  // Where each mark sits on screen: its anchored item's corner plus its offset.
  useLayoutEffect(() => {
    const root = frame.current
    if (!root) return
    const size = parseFloat(getComputedStyle(root).fontSize)
    setEm(size)
    const items = itemsOf(root)
    const margin = marginLeft(root)
    const next = new Map<string, Point>()
    for (const { mark, resolution } of resolved) {
      if (resolution.state === "orphaned") continue
      const item = items.find((i) => resolution.start >= i.start && resolution.start < i.end)
      if (!item) continue
      next.set(mark.id, {
        x: (mark.side === "margin" ? margin : item.box.x) + mark.dx * size,
        y: item.box.y + mark.dy * size,
      })
    }
    setPlaced(next)
  }, [resolved, shownKey, selectedId, data])

  useEffect(() => {
    const root = frame.current
    if (!root) return
    const observer = new ResizeObserver(() => setData((d) => ({ ...d })))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const selected = resolved.find((r) => r.mark.id === selectedId)?.mark
  const mine = (mark: MarkInfo) => mark.user_id === me
  const tray = resolved.filter((r): r is { mark: MarkInfo; resolution: Extract<Resolution, { state: "orphaned" }> } => r.resolution.state === "orphaned")

  // --- Pointer input -------------------------------------------------------

  const framePoint = (event: { clientX: number; clientY: number }): Point => {
    const box = frame.current!.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  /**
   * Anchors a mark whose top-left is `corner`. The item is the one nearest
   * `probe` (the mark's center, or the click point for a click-placed mark);
   * in the margin it is the item nearest the probe's height.
   */
  const placementAt = (corner: Point, probe: Point, scale: number): Placement | null => {
    const root = frame.current!
    const margin = marginLeft(root)
    const inMargin = probe.x >= margin
    let best: { item: ChartItemBox; distance: number } | null = null
    for (const item of itemsOf(root)) {
      const dy = Math.max(item.box.y - probe.y, 0, probe.y - (item.box.y + item.box.h))
      const dx = inMargin ? 0 : Math.max(item.box.x - probe.x, 0, probe.x - (item.box.x + item.box.w))
      const distance = dy * 4 + dx
      if (!best || distance < best.distance) best = { item, distance }
    }
    if (!best) return null
    return {
      range_start: best.item.start,
      range_end: best.item.end,
      side: inMargin ? "margin" : "inline",
      dx: (corner.x - (inMargin ? margin : best.item.box.x)) / em,
      dy: (corner.y - best.item.box.y) / em,
      scale,
    }
  }

  const payload = (placement: Placement, body: Body, visibility: MarkData["visibility"] = "private"): MarkData => ({
    revision_id: chart.revision_id,
    scope: { kind: "chart" },
    ...placement,
    body,
    visibility,
  })

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === "read" || !toolbar) return
    // Without this, a mouse drag over chart text starts a text selection or a
    // native drag, and the browser cancels the pointer stream mid-gesture.
    event.preventDefault()
    const point = framePoint(event)
    const markNode = (event.target as HTMLElement).closest<HTMLElement>("[data-mark-id]")
    if (tool === "move") {
      const mark = markNode && data.marks.find((m) => m.id === markNode.dataset.markId)
      if (!mark || !mine(mark)) {
        setSelectedId(null)
        return
      }
      setSelectedId(mark.id)
      dragMark(event, mark, markNode, point, (event.target as HTMLElement).dataset.handle === "resize")
      return
    }
    if (tool === "ink") {
      drawStroke(event)
      return
    }
    const body: Body | null =
      tool === "text"
        ? text.trim() ? { kind: "text", text: text.trim() } : null
        : (stampList.find((s) => s.id === stampId)?.body ?? null)
    const placement = body && placementAt(point, point, 1)
    if (body && placement) void write(() => marksApi.create(payload(placement, structuredClone(body))))
  }

  /** Moves or resizes a mark; on release it is anchored again to the item under its new center. */
  const dragMark = (event: ReactPointerEvent, mark: MarkInfo, node: HTMLElement, start: Point, resizing: boolean) => {
    const root = frame.current!
    const origin = { x: parseFloat(node.style.left), y: parseFloat(node.style.top) }
    const width = node.getBoundingClientRect().width
    const scaleAt = (point: Point) => Math.max(0.3, mark.scale * ((width + point.x - start.x) / width))
    root.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent) => {
      const point = framePoint(move)
      if (resizing) node.style.transform = `scale(${scaleAt(point)})`
      else {
        node.style.left = `${origin.x + point.x - start.x}px`
        node.style.top = `${origin.y + point.y - start.y}px`
      }
    }
    const onUp = (up: PointerEvent) => {
      root.removeEventListener("pointermove", onMove)
      root.removeEventListener("pointerup", onUp)
      root.removeEventListener("pointercancel", onUp)
      const point = framePoint(up)
      let placement: Placement | null
      if (resizing) {
        placement = { range_start: mark.range_start, range_end: mark.range_end, side: mark.side, dx: mark.dx, dy: mark.dy, scale: scaleAt(point) }
      } else {
        const box = relativeBox(node, root)
        const corner = { x: origin.x + point.x - start.x, y: origin.y + point.y - start.y }
        placement = placementAt(corner, { x: corner.x + box.w / 2, y: corner.y + box.h / 2 }, mark.scale)
      }
      if (placement) void write(() => marksApi.update(mark.id, payload(placement, mark.body, mark.visibility)))
      else void reload()
    }
    root.addEventListener("pointermove", onMove)
    root.addEventListener("pointerup", onUp)
    root.addEventListener("pointercancel", onUp)
  }

  /** Draws one stroke. Strokes drawn close together join one mark, so a figure moves and pastes as a unit. */
  const drawStroke = (event: ReactPointerEvent) => {
    const root = frame.current!
    const points: Array<[number, number, number]> = []
    // The last preview this stroke set. The saved mark is drawn only after the save and the
    // reload, so the preview stays until then: a stroke never vanishes for that round trip.
    let shown: Stroke | null = null
    const add = (e: PointerEvent) => {
      const p = framePoint(e)
      points.push([p.x, p.y, e.pressure || 0.5])
      shown = [...points]
      setPreview(shown)
    }
    root.setPointerCapture(event.pointerId)
    add(event.nativeEvent)
    const onUp = () => {
      root.removeEventListener("pointermove", add)
      root.removeEventListener("pointerup", onUp)
      root.removeEventListener("pointercancel", onUp)
      const stroke: Stroke = points
      const finished = shown
      void write(async () => {
        const draft = inkDraft.current
        const joins = draft && data.marks.some((m) => m.id === draft.markId) && near(boundsOf(draft.strokes), boundsOf([stroke]), em)
        const strokes = joins ? [...draft.strokes, stroke] : [stroke]
        const bounds = boundsOf(strokes)
        const pad = em * 0.2
        const placement = placementAt(
          { x: bounds.x - pad, y: bounds.y - pad },
          { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
          1,
        )
        if (!placement) return
        const body: Body = {
          kind: "ink",
          strokes: strokes.map((s) => s.map(([x, y, p]) => [(x - bounds.x + pad) / em, (y - bounds.y + pad) / em, p] as [number, number, number])),
          width: (bounds.w + 2 * pad) / em,
          height: (bounds.h + 2 * pad) / em,
        }
        const saved = joins ? await marksApi.update(draft.markId, payload(placement, body)) : await marksApi.create(payload(placement, body))
        inkDraft.current = { markId: saved.id, strokes }
      }).finally(() => {
        // A stroke begun meanwhile has set its own preview; only this stroke's is cleared.
        setPreview((current) => (current === finished ? null : current))
      })
    }
    root.addEventListener("pointermove", add)
    root.addEventListener("pointerup", onUp)
    root.addEventListener("pointercancel", onUp)
  }

  // --- Actions on the selected mark ---------------------------------------

  const toggleShare = () =>
    selected &&
    void write(() => marksApi.update(selected.id, payload(selected, selected.body, selected.visibility === "band" ? "private" : "band")))

  const remove = (mark: MarkInfo) => {
    if (selectedId === mark.id) setSelectedId(null)
    void write(() => marksApi.remove(mark.id))
  }

  const saveStamp = () =>
    selected &&
    void write(async () => {
      const stamp = await stampsApi.create({ name: stampName.trim() || "stamp", body: selected.body })
      setStampId(stamp.id)
      setStampName("")
    })

  return (
    <div className="space-y-2">
      {toolbar && annotating && (
        <>
      <div data-pwid="marks-toolbar" className="flex flex-wrap items-center gap-2">
        {TOOLS.map(({ tool: t, label }) => (
          <button
            key={t}
            data-pwid={`tool-${t}`}
            type="button"
            aria-pressed={tool === t}
            onClick={() => {
              setTool(t)
              inkDraft.current = null
            }}
            className={`${buttonClass} ${tool === t ? "!bg-[var(--color-amber-accent)] !text-zinc-950" : ""}`}
          >
            {label}
          </button>
        ))}
        {tool === "text" && (
          <input
            data-pwid="mark-text-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type, then click the chart"
            aria-label="Text to place"
            className="w-56 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs"
          />
        )}
        {tool === "stamp" && (
          <select
            data-pwid="stamp-select"
            value={stampId}
            onChange={(e) => setStampId(e.target.value)}
            aria-label="Stamp to paste"
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs"
          >
            <option value="">{stampList.length === 0 ? "No stamps yet" : "Choose a stamp"}</option>
            {stampList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* A fixed-height row: the chart must not move when a mark is selected, or a drag in progress lands off target. */}
      <div className="flex min-h-8 items-center">
        {selected && mine(selected) && (
          <span data-pwid="mark-actions" className="flex flex-wrap items-center gap-2">
            <button data-pwid="mark-share" type="button" onClick={toggleShare} className={buttonClass}>
              {selected.visibility === "band" ? "Make private" : "Share with band"}
            </button>
            <input
              data-pwid="mark-stamp-name"
              value={stampName}
              onChange={(e) => setStampName(e.target.value)}
              placeholder="Stamp name"
              aria-label="Stamp name"
              className="w-28 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs"
            />
            <button data-pwid="mark-stamp-save" type="button" onClick={saveStamp} className={buttonClass}>
              Save as stamp
            </button>
            <button data-pwid="mark-delete" type="button" onClick={() => remove(selected)} className={buttonClass}>
              Delete mark
            </button>
          </span>
        )}
      </div>

        </>
      )}

      {showChordsAbove && diagrams !== "off" && chords.length > 0 && (
        <ChordStrip chords={chords} shownKey={shownKey} diagrams={diagrams} />
      )}

      <div
        ref={frame}
        data-pwid="marked-chart"
        onPointerDown={onPointerDown}
        style={{ touchAction: tool === "read" ? "auto" : "none", userSelect: tool === "read" ? "auto" : "none" }}
        className={`relative flex ${tool === "read" ? "" : tool === "move" ? "cursor-default" : "cursor-crosshair"}`}
      >
        <div className="min-w-0 flex-1">
          <LyricsChart
            source={chart.source}
            shownKey={shownKey}
            tempo={tempo}
            size={size}
            chordShapes={tool === "read" && diagrams !== "off"}
            diagrams={diagrams}
            numeralDisplay={numeralDisplay}
            scoreCharts={scoreCharts}
          />
        </div>
        <div className="pointer-events-none absolute inset-0">
          {resolved.map(({ mark, resolution }) => {
            const at = placed.get(mark.id)
            if (resolution.state === "orphaned" || !at) return null
            return (
              <MarkView
                key={mark.id}
                mark={mark}
                state={resolution.state}
                at={at}
                em={em}
                own={mine(mark)}
                selected={mark.id === selectedId}
                movable={tool === "move" && mine(mark)}
              />
            )
          })}
          <svg className="absolute inset-0 h-full w-full overflow-visible">
            {preview && <path d={inkPath(preview, em)} className="fill-blue-500/70" />}
          </svg>
        </div>
      </div>

      {error && <div data-pwid="marks-error" className="text-sm text-red-400">{error}</div>}

      {toolbar && tray.length > 0 && (
        <div data-pwid="tray" className="rounded-md border border-[var(--color-border-subtle)] p-3 text-xs space-y-1">
          <div className="font-semibold text-zinc-300">Marks whose place is gone</div>
          {tray.map(({ mark, resolution }) => (
            <div key={mark.id} data-pwid="tray-item" className="flex items-center justify-between gap-2 text-zinc-400">
              <span>
                {summary(mark.body)}: {resolution.reason === "deleted" ? "its words were deleted" : "its place is uncertain after a paste-over"}
                {!mine(mark) && " (shared by a bandmate)"}
              </span>
              {mine(mark) && (
                <button data-pwid="tray-delete" type="button" onClick={() => remove(mark)} className={buttonClass}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MarkView({
  mark,
  state,
  at,
  em,
  own,
  selected,
  movable,
}: {
  mark: MarkInfo
  state: "kept" | "changed"
  at: Point
  em: number
  own: boolean
  selected: boolean
  movable: boolean
}) {
  return (
    <div
      data-mark-id={mark.id}
      data-pwid="mark"
      data-kind={mark.body.kind}
      data-state={state}
      data-shared={mark.visibility === "band" ? (own ? "mine" : "theirs") : "private"}
      title={own ? undefined : "Shared by a bandmate"}
      style={{ left: at.x, top: at.y, transform: `scale(${mark.scale})`, transformOrigin: "top left", fontSize: em }}
      className={`absolute whitespace-pre ${movable ? "pointer-events-auto cursor-move" : ""} ${
        selected ? "outline outline-1 outline-dashed outline-[var(--color-amber-accent)]" : ""
      } ${own ? "text-blue-400" : "text-emerald-400"}`}
    >
      {mark.body.kind === "text" ? (
        mark.body.text
      ) : (
        <svg width={mark.body.width * em} height={mark.body.height * em} className="fill-current">
          {mark.body.strokes.map((stroke, i) => (
            <path key={i} d={inkPath(stroke.map(([x, y, p]) => [x * em, y * em, p] as const), em)} />
          ))}
        </svg>
      )}
      {state === "changed" && <span className="ml-1 align-super text-[0.6em] text-amber-400">changed</span>}
      {selected && <span data-handle="resize" className="pointer-events-auto absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize bg-[var(--color-amber-accent)]" />}
    </div>
  )
}

function summary(body: Body): string {
  return body.kind === "text" ? `text "${body.text}"` : `ink (${body.strokes.length} stroke${body.strokes.length === 1 ? "" : "s"})`
}

type ChartItemBox = { start: number; end: number; box: Box }

/**
 * Where a mark placed in the margin is anchored: the x of the strip at the chart's
 * right edge, MARGIN_EM wide. It is not a box of its own, so the lyrics keep the
 * full width and a margin mark sits over the last words of the lines.
 */
const MARGIN_EM = 8
function marginLeft(root: HTMLElement): number {
  return root.clientWidth - MARGIN_EM * parseFloat(getComputedStyle(root).fontSize)
}

/** The chart's items on screen, with their anchor ranges and boxes relative to `root`. */
function itemsOf(root: HTMLElement): ReadonlyArray<ChartItemBox> {
  return [...root.querySelectorAll<HTMLElement>("[data-start]")].map((node) => ({
    start: Number(node.dataset.start),
    end: Number(node.dataset.end),
    box: relativeBox(node, root),
  }))
}

function relativeBox(node: Element, container: Element): Box {
  const a = node.getBoundingClientRect()
  const b = container.getBoundingClientRect()
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height }
}
