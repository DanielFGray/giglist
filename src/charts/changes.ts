/**
 * Change sets: how one revision of a chart became the next (docs/adr/0001).
 *
 * A change replaces `[from, to)` of the earlier revision's anchor text with
 * `insert` characters. A change set is sorted and has no overlapping changes.
 * The editor records one per edit; a marks module maps anchors through them.
 */
export type Change = { readonly from: number; readonly to: number; readonly insert: number }

/**
 * The change set that does `first`, then `second`, as one change set against
 * the text `first` started from. Text that `first` inserted and `second`
 * deleted again leaves no trace.
 */
export function composeChanges(first: ReadonlyArray<Change>, second: ReadonlyArray<Change>): Array<Change> {
  const a = toAtoms(first)
  const b = toAtoms(second)
  const out: Array<Atom> = []
  let i = 0
  let j = 0
  let ra = a[0]!.n
  let rb = b[0]!.n
  while (!(a[i]!.kind === "retain" && ra === Infinity && b[j]!.kind === "retain" && rb === Infinity)) {
    const x = a[i]!
    const y = b[j]!
    if (x.kind === "delete") {
      out.push({ kind: "delete", n: ra })
      i++
      ra = a[i]!.n
    } else if (y.kind === "insert") {
      out.push({ kind: "insert", n: rb })
      j++
      rb = b[j]!.n
    } else {
      const n = Math.min(ra, rb)
      if (x.kind === "retain" && y.kind === "retain") out.push({ kind: "retain", n })
      else if (x.kind === "retain" && y.kind === "delete") out.push({ kind: "delete", n })
      else if (x.kind === "insert" && y.kind === "retain") out.push({ kind: "insert", n })
      ra -= n
      rb -= n
      if (ra === 0) {
          i++
        ra = a[i]!.n
      }
      if (rb === 0) {
          j++
        rb = b[j]!.n
      }
    }
  }
  return fromAtoms(out)
}

/** Whether `changes` is a valid change set: sorted, without overlap, with no empty change. */
export function isChangeSet(changes: ReadonlyArray<Change>): boolean {
  let end = 0
  return changes.every((c) => {
    const ok = Number.isInteger(c.from) && Number.isInteger(c.to) && Number.isInteger(c.insert) &&
      c.from >= end && c.to >= c.from && c.insert >= 0 && (c.to > c.from || c.insert > 0)
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
    to += c.from - from + c.insert
    from = c.to
  }
  return after.slice(to) === before.slice(from)
}

/** The length of the later text, given the length of the earlier one. */
export function lengthAfter(length: number, changes: ReadonlyArray<Change>): number {
  return changes.reduce((n, c) => n + c.insert - (c.to - c.from), length)
}

type Atom = { kind: "retain" | "delete" | "insert"; n: number }

function toAtoms(changes: ReadonlyArray<Change>): Array<Atom> {
  // The last atom keeps the rest of the text, however long it is.
  const atoms: Array<Atom> = []
  let at = 0
  for (const c of changes) {
    if (c.from > at) atoms.push({ kind: "retain", n: c.from - at })
    if (c.to > c.from) atoms.push({ kind: "delete", n: c.to - c.from })
    if (c.insert > 0) atoms.push({ kind: "insert", n: c.insert })
    at = c.to
  }
  atoms.push({ kind: "retain", n: Infinity })
  return atoms
}

function fromAtoms(atoms: ReadonlyArray<Atom>): Array<Change> {
  const changes: Array<Change> = []
  let at = 0
  let open: { from: number; deleted: number; inserted: number } | undefined
  for (const atom of atoms) {
    if (atom.kind === "retain") {
      if (open) changes.push({ from: open.from, to: open.from + open.deleted, insert: open.inserted })
      open = undefined
      at += atom.n
      continue
    }
    open ??= { from: at, deleted: 0, inserted: 0 }
    if (atom.kind === "delete") {
      open.deleted += atom.n
      at += atom.n
    } else {
      open.inserted += atom.n
    }
  }
  if (open) changes.push({ from: open.from, to: open.from + open.deleted, insert: open.inserted })
  return changes
}
