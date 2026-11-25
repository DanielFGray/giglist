import type { ChartInfo, ChartRevisionData } from "~/api/client"
import { composeChanges } from "gigbag.js/charts/changes"
import { parseDoc, serializeDoc, type ChartDoc, type Edit } from "gigbag.js/charts/doc"

/**
 * The unsaved edits to one lyrics chart. A draft keeps the revision it started
 * from, so a chart saved by someone else meanwhile makes the save fail with a
 * conflict instead of storing a change set built on other text.
 */
export type ChartDraft = {
  readonly revisionId: string
  readonly source: string
  readonly steps: ReadonlyArray<Edit>
  /** Chords typed over a word that no chip had. They stay on the chips while the draft lives. */
  readonly extra: ReadonlyArray<string>
}

/** A draft with no edits yet, on the chart's current revision. */
export const startDraft = (chart: ChartInfo & { source: string }): ChartDraft => ({
  revisionId: chart.revision_id,
  source: chart.source,
  steps: [],
  extra: [],
})

export const draftDoc = (draft: ChartDraft): ChartDoc => draft.steps.at(-1)?.doc ?? parseDoc(draft.source)

export const draftChanged = (draft: ChartDraft | undefined): boolean => (draft?.steps.length ?? 0) > 0

/** The revision a draft saves: its text, and every step's changes composed into one set (docs/adr/0001). */
export const draftRevision = (draft: ChartDraft): ChartRevisionData => ({
  parent_id: draft.revisionId,
  source: serializeDoc(draftDoc(draft)),
  changes: draft.steps.reduce<Array<{ from: number; to: number; insert: number }>>((all, step) => composeChanges(all, step.changes), []),
})
