import { useState } from "react"
import { charts, type ChartInfo } from "~/api/client"
import { draftChanged, draftRevision, startDraft, type ChartDraft } from "./chart-draft"
import { errorMessage } from "./form"

/**
 * The song page's edit mode, as the charts take part in it: which chart's
 * editor is open, the unsaved drafts the page saves, and the errors its last
 * save left on charts.
 */
export type ChartEditing = {
  readonly active: string | null
  /** The chart the player chose to edit, which the page scrolls to; null while the first chart is open by default. */
  readonly picked: string | null
  readonly drafts: Readonly<Record<string, ChartDraft>>
  readonly errors: Readonly<Record<string, string>>
  readonly open: (chartId: string | null) => void
  readonly update: (chart: ChartInfo & { source: string }, update: (draft: ChartDraft) => ChartDraft) => void
  /** Drops a deleted chart's draft. */
  readonly forget: (chartId: string) => void
}

/**
 * The drafts of a song's lyrics charts while the page is in edit mode. With no
 * chart picked, the first lyrics chart's editor is the open one.
 */
export function useChartDrafts(list: ReadonlyArray<ChartInfo>) {
  const [picked, setPicked] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Readonly<Record<string, ChartDraft>>>({})
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const active = picked ?? list.find((chart) => chart.kind === "lyrics")?.id ?? null

  const editing: ChartEditing = {
    active,
    picked,
    drafts,
    errors,
    open: setPicked,
    update: (chart, update) => setDrafts((all) => ({ ...all, [chart.id]: update(all[chart.id] ?? startDraft(chart)) })),
    forget: (chartId) => {
      setDrafts((all) => withoutKeys(all, (id) => id === chartId))
      if (picked === chartId) setPicked(null)
    },
  }

  /**
   * Saves every changed draft as one revision. A chart that saves drops its
   * draft; one that fails keeps it, with its error. True when all saved.
   */
  const save = async (): Promise<boolean> => {
    setErrors({})
    const changed = Object.entries(drafts).filter(([, draft]) => draftChanged(draft))
    const results = await Promise.allSettled(changed.map(([id, draft]) => charts.saveRevision(id, draftRevision(draft))))
    const failed = Object.fromEntries(
      changed.flatMap(([id], i) => {
        const result = results[i]!
        return result.status === "rejected" ? [[id, errorMessage(result.reason)]] : []
      }),
    )
    setDrafts((all) => withoutKeys(all, (id) => !(id in failed)))
    setErrors(failed)
    return Object.keys(failed).length === 0
  }

  return {
    editing,
    changed: Object.values(drafts).filter(draftChanged).length,
    canUndo: active !== null && draftChanged(drafts[active]),
    /** Takes back the open chart's last step. */
    undo: () => {
      if (active) setDrafts((all) => (all[active] ? { ...all, [active]: { ...all[active], steps: all[active].steps.slice(0, -1) } } : all))
    },
    save,
    /** Drops every draft and error, and the pick. */
    clear: () => {
      setDrafts({})
      setErrors({})
      setPicked(null)
    },
  }
}

const withoutKeys = <T>(all: Readonly<Record<string, T>>, drop: (key: string) => boolean): Record<string, T> =>
  Object.fromEntries(Object.entries(all).filter(([key]) => !drop(key)))
