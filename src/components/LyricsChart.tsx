import { useEffect, useId, useMemo, useState, type CSSProperties } from "react"
import type { ChartInfo } from "~/api/client"
import { renderLyrics, type ChartItem, type ChartLine } from "~/charts/lyrics"
import { chordNumerals, type NumeralDisplay } from "~/charts/numeral"
import { ChordShapes, type ChordDiagrams } from "./ChordShapes"
import { preloadChordPlayer } from "~/audio/chord"
import { Phrase } from "./Phrase"
import { ScoreLink } from "./ScoreLink"

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
  diagrams = "guitar",
  numeralDisplay = "both",
  scoreCharts,
}: {
  source: string
  shownKey: string | null
  /** The song's tempo, which its phrases play at. */
  tempo?: number | null
  /** Text size in rem; marks are placed in em of this size, so they scale with it. */
  size?: number
  /** False while another tool has the chart: a chord then draws no shapes. */
  chordShapes?: boolean
  /** Guitar diagrams or a staff picture. Ignored unless chordShapes is true. */
  diagrams?: ChordDiagrams
  /** What to show for each chord: its name, its Roman numeral, or both. Default: both. */
  numeralDisplay?: NumeralDisplay
  /** The song's score charts. A score link draws the latest revision of the one it names. */
  scoreCharts: ReadonlyArray<ChartInfo>
}) {
  const lines = useMemo(() => renderLyrics(source, shownKey), [source, shownKey])
  // Each chord's numeral, by the start of its item. They are read in one pass over the chart, since a chord's numeral depends on the chord after it.
  const numerals = useMemo(() => {
    const pairs = lines.flat().flatMap((item) => (item.kind === "pair" && item.chord !== "" ? [item] : []))
    const labels = chordNumerals(pairs.map((pair) => pair.chord), shownKey)
    return new Map(pairs.map((pair, index) => [pair.start, labels[index] ?? null]))
  }, [lines, shownKey])
  // The start of the item whose panel is open, or null when none is.
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    if (chordShapes === false || diagrams === "off") return
    preloadChordPlayer()
  }, [chordShapes, diagrams])
  // Anchor names are shared by the whole page, so each chart names its chords with its own prefix.
  const anchor = useId().replace(/\W/g, "")

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
        <Line
          key={index}
          line={line}
          tempo={tempo}
          chordShapes={chordShapes}
          diagrams={diagrams}
          open={open}
          setOpen={setOpen}
          anchor={anchor}
          shownKey={shownKey}
          numerals={numerals}
          numeralDisplay={numeralDisplay}
          scoreCharts={scoreCharts}
        />
      ))}
    </div>
  )
}

function Line({
  line,
  tempo,
  chordShapes,
  diagrams,
  open,
  setOpen,
  anchor,
  shownKey,
  numerals,
  numeralDisplay,
  scoreCharts,
}: {
  line: ChartLine
  tempo: number | null
  chordShapes: boolean
  diagrams: ChordDiagrams
  open: number | null
  setOpen: (start: number | null) => void
  anchor: string
  shownKey: string | null
  numerals: ReadonlyMap<number, string | null>
  numeralDisplay: NumeralDisplay
  scoreCharts: ReadonlyArray<ChartInfo>
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
  if (only?.kind === "score") {
    const link = "link" in only.reading ? only.reading.link : null
    const revisionId = link === null ? undefined : scoreCharts.find((chart) => chart.id === link.chartId)?.revision_id
    return (
      <div data-pwid="chart-score-link" className="my-2">
        <ScoreLink reading={only.reading} revisionId={revisionId} />
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-end">
      {line.map((item, index) => (
        <Item
          key={index}
          item={item}
          chordShapes={chordShapes}
          diagrams={diagrams}
          open={open}
          setOpen={setOpen}
          anchor={anchor}
          shownKey={shownKey}
          numerals={numerals}
          numeralDisplay={numeralDisplay}
        />
      ))}
    </div>
  )
}

function Item({
  item,
  chordShapes,
  diagrams,
  open,
  setOpen,
  anchor,
  shownKey,
  numerals,
  numeralDisplay,
}: {
  item: ChartItem
  chordShapes: boolean
  diagrams: ChordDiagrams
  open: number | null
  setOpen: (start: number | null) => void
  anchor: string
  shownKey: string | null
  numerals: ReadonlyMap<number, string | null>
  numeralDisplay: NumeralDisplay
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
      const chordNumeral = numerals.get(item.start) ?? null
      // A chord with no numeral (no key, or a name that does not spell) keeps its name, even in numerals-only mode.
      const showNumeral = chordNumeral !== null && numeralDisplay !== "names"
      const showName = !showNumeral || numeralDisplay === "both"
      // The name keeps its row when hidden, so the numeral sits where the name would.
      const nameClass = showName ? chordClass : `${chordClass} invisible`
      // Every column of a line draws the same rows, each its full height even when
      // empty: the line aligns its columns at the bottom, so a shorter column (the
      // last chord of a chords-only line, or one with no numeral) would drop its chord.
      const numeralRow = shownKey !== null && numeralDisplay !== "names"

      // The numeral is outside the chord element, so the chord element's text is the name alone.
      return (
        <span data-start={item.start} data-end={item.end} className={`inline-flex flex-col ${openable ? "relative" : ""}`}>
          {openable ? (
            <button
              type="button"
              data-pwid="chart-chord"
              aria-expanded={showing}
              onClick={() => setOpen(showing ? null : item.start)}
              style={{ anchorName: `--chord-${anchor}-${item.start}` } as CSSProperties}
              className={`${nameClass} cursor-pointer border-0 bg-transparent text-left`}
            >
              {item.chord}
            </button>
          ) : (
            <span data-pwid="chart-chord" className={nameClass}>
              {item.chord}
            </span>
          )}
          {numeralRow &&
            (showNumeral ? (
              <span data-pwid="chart-numeral" className={numeralClass}>{chordNumeral}</span>
            ) : (
              <span className={numeralClass} />
            ))}
          <span data-pwid="chart-lyric" className="min-h-[1lh] whitespace-pre">{item.lyric}</span>
          {showing && <ChordShapes name={item.chord} shownKey={shownKey} anchor={`--chord-${anchor}-${item.start}`} diagrams={diagrams} />}
        </span>
      )
    }
  }
}

const chordClass = "h-5 whitespace-pre pr-3 text-[1.25em] font-semibold"
const numeralClass = "h-3 whitespace-pre pr-3 text-[0.8em] leading-3 text-zinc-500"

/** The note on tab or notation shown in another key: it is drawn as written, in the written key. */
function WrittenIn({ what, keyName, spaced }: { what: "tab" | "notation"; keyName: string; spaced: boolean }) {
  return (
    <span data-pwid="chart-written-in" className={`${spaced ? "ml-2 " : ""}normal-case tracking-normal font-normal text-zinc-500`}>
      {what} as written, in {keyName}
    </span>
  )
}
