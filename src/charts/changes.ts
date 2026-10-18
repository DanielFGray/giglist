/**
 * Change sets: how one revision of a chart became the next (docs/adr/0001).
 *
 * A change replaces `[from, to)` of the earlier revision's anchor text with
 * `insert` characters. A change set is sorted and has no overlapping changes.
 * The editor records one per edit; a marks module maps anchors through them.
 */
export type Change = { readonly from: number; readonly to: number; readonly insert: number; readonly source?: number }

/**
 * The change set that does `first`, then `second`, as one change set against
 * the text `first` started from. Text that `first` inserted and `second`
 * deleted again leaves no trace; text that either moved keeps its link, and a
 * move that is undone leaves no change.
 */
export function composeChanges(first: ReadonlyArray<Change>, second: ReadonlyArray<Change>): Array<Change> {
  return fromPieces(composePieces(toPieces(first), toPieces(second)))
}

/** Whether `changes` is a valid change set: sorted, without overlap, with no empty change. */
export function isChangeSet(changes: ReadonlyArray<Change>): boolean {
  let end = 0
  const sources = changes.flatMap((change) => change.source === undefined ? [] : [{ start: change.source, end: change.source + change.insert }]).sort((a, b) => a.start - b.start)
  const sourcesOverlap = sources.some((source, i) => i > 0 && source.start < sources[i - 1]!.end)
  return !sourcesOverlap && changes.every((c) => {
    const source = c.source
    // A source must belong to one other deleted change, so it cannot be a copy.
    const covered = source === undefined || changes.some((other) =>
      other !== c && other.to > other.from && other.from <= source && source + c.insert <= other.to,
    )
    const ok = Number.isInteger(c.from) && Number.isInteger(c.to) && Number.isInteger(c.insert) &&
      (source === undefined || (Number.isInteger(source) && c.insert > 0)) && c.from >= end && c.to >= c.from &&
      c.insert >= 0 && (c.to > c.from || c.insert > 0) && covered
    end = c.to
    return ok
  })
}

/**
 * Whether `changes` turns `before` into `after`: the text outside the changes
 * is the same in both. The changed stretches themselves are not compared, so
 * this proves where the text kept its place, which is what marks rely on.
 */
export function explains(before: string, after: string, changes: ReadonlyArray<Change>): boolean {
  if (!isChangeSet(changes) || changes.some((c) => c.to > before.length)) return false
  let from = 0
  let to = 0
  for (const c of changes) {
    if (after.slice(to, to + c.from - from) !== before.slice(from, c.from)) return false
    if (c.source !== undefined && after.slice(to + c.from - from, to + c.from - from + c.insert) !== before.slice(c.source, c.source + c.insert)) return false
    to += c.from - from + c.insert
    from = c.to
  }
  return after.slice(to) === before.slice(from)
}

/** The length of the later text, given the length of the earlier one. */
export function lengthAfter(length: number, changes: ReadonlyArray<Change>): number {
  return changes.reduce((n, c) => n + c.insert - (c.to - c.from), length)
}

/**
 * A change set read as the later text, piece by piece: each piece is a copy of
 * `[from, from + n)` of the earlier text, or new text when `from` is undefined.
 * The last piece is the unchanged rest and has `n` of Infinity. Composing change
 * sets is then composing these maps, which keeps every move's link exact.
 */
type Piece = { readonly n: number; readonly from: number | undefined }

function toPieces(changes: ReadonlyArray<Change>): Array<Piece> {
  const pieces: Array<Piece> = []
  let at = 0
  for (const c of changes) {
    if (c.from > at) pieces.push({ n: c.from - at, from: at })
    if (c.insert > 0) pieces.push({ n: c.insert, from: c.source })
    at = c.to
  }
  pieces.push({ n: Infinity, from: at })
  return pieces
}

/** `second` copies ranges of the text `first` made; read each range through `first`'s pieces. */
function composePieces(first: ReadonlyArray<Piece>, second: ReadonlyArray<Piece>): Array<Piece> {
  const out: Array<Piece> = []
  for (const piece of second) {
    if (piece.from === undefined) {
      push(out, piece)
      continue
    }
    let start = piece.from
    let left = piece.n
    let offset = 0
    for (const through of first) {
      if (left === 0) break
      if (start >= offset + through.n) {
        offset += through.n
        continue
      }
      const skip = start - offset
      const n = Math.min(through.n - skip, left)
      push(out, { n, from: through.from === undefined ? undefined : through.from + skip })
      start += n
      left -= n
      offset += through.n
    }
  }
  return out
}

/**
 * Turns pieces back into a change set. A piece that copies the next unread
 * stretch of the earlier text stays in place; text skipped over is deleted,
 * and a piece that copies text from before the cursor is a move, written as an
 * insert with its `source`. Inserts at one position come before the change
 * that deletes there, as a change set must be sorted.
 */
function fromPieces(pieces: ReadonlyArray<Piece>): Array<Change> {
  const changes: Array<Change> = []
  let at = 0
  let inserts: Array<Piece> = []
  const flush = (deleted: number) => {
    const last = inserts.at(-1)
    const fuse = deleted > 0 && last !== undefined && last.from === undefined
    for (const piece of fuse ? inserts.slice(0, -1) : inserts) {
      changes.push({ from: at, to: at, insert: piece.n, ...(piece.from === undefined ? {} : { source: piece.from }) })
    }
    if (fuse) changes.push({ from: at, to: at + deleted, insert: last.n })
    else if (deleted > 0) changes.push({ from: at, to: at + deleted, insert: 0 })
    inserts = []
  }
  for (const piece of pieces) {
    if (piece.from !== undefined && piece.from >= at) {
      flush(piece.from - at)
      at = piece.from + piece.n
    } else push(inserts, piece)
  }
  flush(0)
  return changes
}

/** Appends `piece`, joining it to the one before when they continue each other. */
function push(pieces: Array<Piece>, piece: Piece): void {
  const last = pieces.at(-1)
  const joins = last !== undefined && Number.isFinite(last.n) &&
    (last.from === undefined ? piece.from === undefined : piece.from === last.from + last.n)
  if (last !== undefined && joins) pieces[pieces.length - 1] = { n: last.n + piece.n, from: last.from }
  else pieces.push(piece)
}
