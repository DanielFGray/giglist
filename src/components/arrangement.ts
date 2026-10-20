import { Option } from "effect"

/**
 * Reordering a flat list (a setlist's songs, a gig's setlists). The UI says
 * where a row should go; the server takes one neighbour-based move, so two
 * people moving different rows at once both keep their moves.
 */
export type Move = { readonly id: string; readonly previous: string | null }

/**
 * The move that puts `id` at `index` of the list as it reads with `id` in its
 * new place: right after the row that will stand before it, or first. None
 * when `id` is not in the list or would not move.
 */
export function moveTo(ids: ReadonlyArray<string>, id: string, index: number): Option.Option<Move> {
  const from = ids.indexOf(id)
  const others = ids.filter((other) => other !== id)
  const to = Math.min(Math.max(index, 0), others.length)
  if (from < 0 || from === to) return Option.none()
  return Option.some({ id, previous: others[to - 1] ?? null })
}

/** The move one place up (-1) or down (1); none at either end. */
export function stepMove(ids: ReadonlyArray<string>, id: string, delta: -1 | 1): Option.Option<Move> {
  return moveTo(ids, id, ids.indexOf(id) + delta)
}
