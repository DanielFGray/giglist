/**
 * Following an anchor across revisions (docs/adr/0001).
 *
 * A mark is anchored to a range of the anchor text of the revision it was made
 * on. To show it on a later revision, the range is mapped through each
 * revision's change set. The editor records its change sets; a revision from
 * outside the editor has none, and one is derived with a whole-text diff.
 * Where a derived diff could have aligned repeated content either way, the
 * mark is orphaned as "uncertain" instead of guessed.
 */
import DiffMatchPatch from "diff-match-patch"
import type { Change } from "./changes"

export type Range = { readonly start: number; readonly end: number }

/** Two consecutive revisions. `recorded` is the editor's change set, or null for a revision from outside the editor. */
export type Step = { readonly before: string; readonly after: string; readonly recorded: ReadonlyArray<Change> | null }

/**
 * `kept`: the marked content is unchanged.
 * `changed`: the marked content was edited; the view flags the mark.
 * `orphaned`: the content was deleted, or a derived diff cannot say where it went (`uncertain`); the mark goes to the tray.
 */
export type Resolution =
  | { readonly state: "kept" | "changed"; readonly start: number; readonly end: number }
  | { readonly state: "orphaned"; readonly reason: "deleted" | "uncertain" }

export function follow(range: Range, steps: ReadonlyArray<Step>): Resolution {
  let current: Resolution = { state: "kept", ...range }
  for (const step of steps) {
    if (current.state === "orphaned") return current
    const next = followStep(current, step)
    current = next.state === "kept" && current.state === "changed" ? { ...next, state: "changed" } : next
  }
  return current
}

function followStep(range: Range, step: Step): Resolution {
  const changes = step.recorded ?? changesBetween(step.before, step.after)
  const mapped = mapRange(range, changes)
  // Checked before "deleted": when one of two identical copies is removed, a
  // derived diff cannot say which, so the marked copy may still exist.
  if (step.recorded === null && withinSlide(range, mapped, changes, step)) {
    return { state: "orphaned", reason: "uncertain" }
  }
  if (!mapped) return { state: "orphaned", reason: "deleted" }
  const changed = step.before.slice(range.start, range.end) !== step.after.slice(mapped.start, mapped.end)
  return { state: changed ? "changed" : "kept", ...mapped }
}

/**
 * Derives the change set between two revisions with a whole-text diff (Myers,
 * via diff-match-patch). A diff aligns the entire text, so repeated choruses
 * confuse it far less than a search around the old position.
 */
export function changesBetween(before: string, after: string): Array<Change> {
  const changes: Array<{ from: number; to: number; insert: number }> = []
  let offset = 0
  for (const [op, text] of new DiffMatchPatch().diff_main(before, after, false)) {
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      offset += text.length
      continue
    }
    let change = changes.at(-1)
    if (!change || change.to !== offset) {
      change = { from: offset, to: offset, insert: 0 }
      changes.push(change)
    }
    if (op === DiffMatchPatch.DIFF_DELETE) {
      change.to += text.length
      offset += text.length
    } else {
      change.insert += text.length
    }
  }
  return changes
}

/** The range after the changes, or null when they deleted all of it. */
export function mapRange(range: Range, changes: ReadonlyArray<Change>): Range | null {
  const start = mapPosition(range.start, changes, "start")
  const end = mapPosition(range.end, changes, "end")
  return end > start ? { start, end } : null
}

/**
 * Content inserted exactly at a mark's start goes before the mark; content
 * inserted at its end stays outside it. A replacement that overlaps the mark
 * becomes part of it.
 */
function mapPosition(position: number, changes: ReadonlyArray<Change>, side: "start" | "end"): number {
  let shift = 0
  for (const change of changes) {
    const delta = change.insert - (change.to - change.from)
    const before = change.to < position || (change.to === position && (change.from < position || side === "start"))
    if (before) {
      shift += delta
      continue
    }
    if (change.from >= position) break
    return side === "start" ? change.from + shift : change.from + shift + change.insert
  }
  return position + shift
}

/**
 * A derived diff picks one of several equally short alignments. Inside repeated
 * material a pure deletion or insertion can slide: deleting `before[from, to)`
 * gives the same result as deleting it shifted by k while the content repeats,
 * and the same holds for inserted content in the later revision. If a slid
 * position touches the mark, the diff cannot say whether the marked content was
 * the part deleted, or which copy the mark belongs to. Recorded change sets are
 * exact and skip this check.
 */
function withinSlide(range: Range, mapped: Range | null, changes: ReadonlyArray<Change>, step: Step): boolean {
  let shift = 0
  for (const change of changes) {
    const deleted = change.to - change.from
    if (change.insert === 0 && overlaps(range, slideSpan(step.before, change.from, change.to))) return true
    if (deleted === 0 && mapped) {
      const at = change.from + shift
      if (touches(mapped, slideSpan(step.after, at, at + change.insert))) return true
    }
    shift += change.insert - deleted
  }
  return false
}

/** The span `[from, to)` can cover when slid left and right through repeated content. */
function slideSpan(text: string, from: number, to: number): Range {
  let left = from
  while (left > 0 && text[left - 1] === text[left - 1 + (to - from)]) left--
  let right = to
  while (right < text.length && text[right] === text[right - (to - from)]) right++
  return { start: left, end: right }
}

function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && a.end > b.start
}

/** Overlapping or adjacent: a mark right next to slid inserted content may belong to either copy. */
function touches(a: Range, b: Range): boolean {
  return a.start <= b.end && a.end >= b.start
}
