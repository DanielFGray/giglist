import type { ChartInfo } from "~/api/client"
import { ToggleButton, ToggleButtonGroup } from "react-aria-components"

/** The kind of chart a page shows, when a song has both: its chord charts, or its score charts. */
export type ChartView = "chords" | "score"

/** Whether a song has a score and a chord chart, the only case where a page offers a choice. */
export function hasBothKinds(list: ReadonlyArray<ChartInfo>): boolean {
  return list.some((chart) => chart.kind === "score") && list.some((chart) => chart.kind !== "score")
}

/** The charts a view shows. A song with one kind shows all of its charts, whatever the view. */
export function chartsInView(list: ReadonlyArray<ChartInfo>, view: ChartView): ReadonlyArray<ChartInfo> {
  if (!hasBothKinds(list)) return list
  const wantScore = view === "score"
  return list.filter((chart) => (chart.kind === "score") === wantScore)
}

const views: ReadonlyArray<{ value: ChartView; label: string }> = [
  { value: "chords", label: "Chord sheet" },
  { value: "score", label: "Score" },
]

/**
 * Switches a page between a song's chord sheet and its score, one at a time.
 * Renders nothing unless the song has both, so a song with one kind is unchanged.
 * The RAC ToggleButtonGroup gives it radio semantics, and the arrow keys move between views.
 */
export function ChartViewToggle({ list, view, onChange }: { list: ReadonlyArray<ChartInfo>; view: ChartView; onChange: (view: ChartView) => void }) {
  if (!hasBothKinds(list)) return null
  return (
    <ToggleButtonGroup
      data-pwid="chart-view"
      aria-label="Show"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[view]}
      onSelectionChange={(keys) => {
        const next = [...keys][0] as ChartView | undefined
        if (next) onChange(next)
      }}
      className="inline-flex self-start rounded-md border border-[var(--color-border-subtle)] p-0.5 text-xs"
    >
      {views.map((option) => (
        <ToggleButton
          key={option.value}
          id={option.value}
          data-pwid={`chart-view-${option.value}`}
          className="cursor-pointer rounded px-3 py-1 text-zinc-400 outline-none data-[selected]:bg-[var(--color-surface-raised)] data-[selected]:text-zinc-100 data-[focus-visible]:ring-2 data-[focus-visible]:ring-[var(--color-amber-accent)]"
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
