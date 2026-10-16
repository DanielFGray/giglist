import { useMemo } from "react"
import { renderLyrics, type ChartItem, type ChartLine } from "~/charts/lyrics"
import { Phrase } from "./Phrase"

/**
 * A lyrics chart drawn in `shownKey`: each chord sits over the word it was placed on.
 * Every item carries its range in the anchor text as `data-start` / `data-end`,
 * which is how marks find the item they are anchored to.
 */
export function LyricsChart({
  source,
  shownKey,
  tempo = null,
  size = 0.875,
}: {
  source: string
  shownKey: string | null
  /** The song's tempo, which its phrases play at. */
  tempo?: number | null
  /** Text size in rem; marks are placed in em of this size, so they scale with it. */
  size?: number
}) {
  const lines = useMemo(() => renderLyrics(source, shownKey), [source, shownKey])
  return (
    <div data-pwid="lyrics-chart" style={{ fontSize: `${size}rem` }} className="font-mono leading-tight">
      {lines.map((line, index) => (
        <Line key={index} line={line} tempo={tempo} />
      ))}
    </div>
  )
}

function Line({ line, tempo }: { line: ChartLine; tempo: number | null }) {
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
        <Item key={index} item={item} />
      ))}
    </div>
  )
}

function Item({ item }: { item: ChartItem }) {
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
    case "pair":
      return (
        <span data-start={item.start} data-end={item.end} className="inline-flex flex-col">
          <span data-pwid="chart-chord" className="h-5 whitespace-pre pr-1 font-semibold text-[var(--color-amber-accent)]">
            {item.chord}
          </span>
          <span data-pwid="chart-lyric" className="whitespace-pre">{item.lyric}</span>
        </span>
      )
  }
}

/** The note on tab or notation shown in another key: it is drawn as written, in the written key. */
function WrittenIn({ what, keyName, spaced }: { what: "tab" | "notation"; keyName: string; spaced: boolean }) {
  return (
    <span data-pwid="chart-written-in" className={`${spaced ? "ml-2 " : ""}normal-case tracking-normal font-normal text-zinc-500`}>
      {what} as written, in {keyName}
    </span>
  )
}
