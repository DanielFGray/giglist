import { useEffect, useMemo, useState } from "react"
import { renderLyrics, type ChartItem, type ChartLine } from "~/charts/lyrics"
import { ChordShapes } from "./ChordShapes"
import { Phrase } from "./Phrase"

/**
 * A lyrics chart drawn in `shownKey`: each chord sits over the word it was placed on.
 * Every item carries its range in the anchor text as `data-start` / `data-end`,
 * which is how marks find the item they are anchored to.
 *
 * With `chordShapes`, each chord is a button that opens the shapes for that
 * chord under itself. One panel is open at a time, and it overlays the chart,
 * so opening one leaves every line where it was.
 */
export function LyricsChart({
  source,
  shownKey,
  tempo = null,
  size = 0.875,
  chordShapes = false,
}: {
  source: string
  shownKey: string | null
  /** The song's tempo, which its phrases play at. */
  tempo?: number | null
  /** Text size in rem; marks are placed in em of this size, so they scale with it. */
  size?: number
  /** False while another tool has the chart: a chord then draws no shapes. */
  chordShapes?: boolean
}) {
  const lines = useMemo(() => renderLyrics(source, shownKey), [source, shownKey])
  // The start of the item whose panel is open, or null when none is.
  const [open, setOpen] = useState<number | null>(null)

  // A tap outside the panel closes it: the player is asking for something else.
  // Tapping the open chord again closes it too, in that chord's own click handler.
  useEffect(() => {
    if (open === null) return
    const outside = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest("[data-pwid=chord-shapes], [data-pwid=chart-chord]")) return
      setOpen(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setOpen(null)
      // Escape closes the panel and nothing more: on stage it would also leave the stage
      // view, whose listener is on window and so runs after this one on document.
      event.stopPropagation()
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  return (
    <div data-pwid="lyrics-chart" style={{ fontSize: `${size}rem` }} className="font-mono leading-tight">
      {lines.map((line, index) => (
        <Line key={index} line={line} tempo={tempo} chordShapes={chordShapes} open={open} setOpen={setOpen} />
      ))}
    </div>
  )
}

function Line({
  line,
  tempo,
  chordShapes,
  open,
  setOpen,
}: {
  line: ChartLine
  tempo: number | null
  chordShapes: boolean
  open: number | null
  setOpen: (start: number | null) => void
}) {
  if (line.length === 0) return <div className="h-4" />
  const only = line.length === 1 ? line[0]! : null
  // Tab and phrases have no chord row above them, and never wrap: their columns are the music.
  if (only?.kind === "tab") {
    return (
      <div data-pwid="chart-tab" data-start={only.start} data-end={only.end} className="whitespace-pre">
        {only.text}
      </div>
    )
  }
  if (only?.kind === "phrase") {
    return (
      <div data-pwid="chart-phrase" data-start={only.start} data-end={only.end} className="my-2">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {only.name}
          {only.writtenIn && <WrittenIn what="notation" keyName={only.writtenIn} spaced={only.name !== ""} />}
        </div>
        <Phrase tex={only.tex} tempo={tempo} />
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-end">
      {line.map((item, index) => (
        <Item key={index} item={item} chordShapes={chordShapes} open={open} setOpen={setOpen} />
      ))}
    </div>
  )
}

function Item({
  item,
  chordShapes,
  open,
  setOpen,
}: {
  item: ChartItem
  chordShapes: boolean
  open: number | null
  setOpen: (start: number | null) => void
}) {
  switch (item.kind) {
    case "section":
      return (
        <span data-pwid="chart-section" data-start={item.start} data-end={item.end} className="mt-3 mb-1 w-full text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {item.label}
          {item.writtenIn && <WrittenIn what="tab" keyName={item.writtenIn} spaced={item.label !== ""} />}
        </span>
      )
    case "comment":
      return <span data-start={item.start} data-end={item.end} className="italic text-zinc-500">{item.text}</span>
    case "tab":
    case "phrase":
      // Each is drawn as a whole line above.
      return null
    case "pair": {
      // An empty slot is padding for the next word, not a chord to hold.
      const openable = chordShapes && item.chord !== ""
      const showing = openable && open === item.start
      return (
        <span data-start={item.start} data-end={item.end} className={`inline-flex flex-col ${openable ? "relative" : ""}`}>
          {openable ? (
            <button
              type="button"
              data-pwid="chart-chord"
              aria-expanded={showing}
              onClick={() => setOpen(showing ? null : item.start)}
              className={`${chordClass} cursor-pointer border-0 bg-transparent text-left`}
            >
              {item.chord}
            </button>
          ) : (
            <span data-pwid="chart-chord" className={chordClass}>
              {item.chord}
            </span>
          )}
          <span data-pwid="chart-lyric" className="whitespace-pre">{item.lyric}</span>
          {showing && <ChordShapes name={item.chord} />}
        </span>
      )
    }
  }
}

const chordClass = "h-5 whitespace-pre pr-1 font-semibold text-[var(--color-amber-accent)]"

/** The note on tab or notation shown in another key: it is drawn as written, in the written key. */
function WrittenIn({ what, keyName, spaced }: { what: "tab" | "notation"; keyName: string; spaced: boolean }) {
  return (
    <span data-pwid="chart-written-in" className={`${spaced ? "ml-2 " : ""}normal-case tracking-normal font-normal text-zinc-500`}>
      {what} as written, in {keyName}
    </span>
  )
}
