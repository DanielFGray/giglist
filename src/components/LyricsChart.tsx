import { useMemo } from "react"
import { renderLyrics, type ChartItem, type ChartLine } from "~/charts/lyrics"

/**
 * A lyrics chart drawn in `shownKey`: each chord sits over the word it was placed on.
 * Every item carries its range in the anchor text as `data-start` / `data-end`,
 * which is how marks find the item they are anchored to.
 */
export function LyricsChart({
  source,
  shownKey,
  size = 0.875,
}: {
  source: string
  shownKey: string | null
  /** Text size in rem; marks are placed in em of this size, so they scale with it. */
  size?: number
}) {
  const lines = useMemo(() => renderLyrics(source, shownKey), [source, shownKey])
  return (
    <div data-pwid="lyrics-chart" style={{ fontSize: `${size}rem` }} className="font-mono leading-tight">
      {lines.map((line, index) => (
        <Line key={index} line={line} />
      ))}
    </div>
  )
}

function Line({ line }: { line: ChartLine }) {
  if (line.length === 0) return <div className="h-4" />
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
        </span>
      )
    case "comment":
      return <span data-start={item.start} data-end={item.end} className="italic text-zinc-500">{item.text}</span>
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
