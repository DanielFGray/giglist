/**
 * A setlist's arrangement: its sections in order, each holding its entries in
 * order. Entries that belong to no section form a group of their own that
 * always comes first. Operations return a new arrangement for the UI; the
 * page turns the changed row into a neighbour-based move for the server.
 */

type Slot = { readonly id: string; readonly section_id: string | null }
export type Section = { readonly id: string; readonly name: string }
export type Group<E extends Slot, S extends Section = Section> = {
  readonly section: S | null
  readonly entries: ReadonlyArray<E>
}

/**
 * Groups entries (already in their stored order) under sections (in order).
 * The unsectioned group is kept only when it has entries or no section exists.
 */
export function groupEntries<E extends Slot, S extends Section>(
  sections: ReadonlyArray<S>,
  entries: ReadonlyArray<E>,
): Array<Group<E, S>> {
  const known = new Set(sections.map((s) => s.id))
  const loose = entries.filter((e) => e.section_id === null || !known.has(e.section_id))
  const groups: Array<Group<E, S>> = sections.map((section) => ({
    section,
    entries: entries.filter((e) => e.section_id === section.id),
  }))
  return loose.length > 0 || sections.length === 0 ? [{ section: null, entries: loose }, ...groups] : groups
}

/** Puts `entryId` into the group of `sectionId`, before `beforeId`, or last when `beforeId` is null. */
export function placeEntry<E extends Slot, S extends Section>(
  groups: ReadonlyArray<Group<E, S>>,
  entryId: string,
  sectionId: string | null,
  beforeId: string | null,
): Array<Group<E, S>> {
  const moving = groups.flatMap((g) => g.entries).find((e) => e.id === entryId)
  if (!moving || beforeId === entryId) return [...groups]
  const withoutIt = groups.map((g) => ({ ...g, entries: g.entries.filter((e) => e.id !== entryId) }))
  const placed = { ...moving, section_id: sectionId }
  const next = withoutIt.map((g) => {
    if ((g.section?.id ?? null) !== sectionId) return g
    const at = beforeId === null ? g.entries.length : g.entries.findIndex((e) => e.id === beforeId)
    const index = at < 0 ? g.entries.length : at
    return { ...g, entries: [...g.entries.slice(0, index), placed, ...g.entries.slice(index)] }
  })
  return next
}

/**
 * Moves an entry one place up (-1) or down (1) in the flat order of the
 * setlist, crossing into the neighbouring section at a boundary. This is the
 * keyboard route; drag and drop is the pointer route.
 */
export function stepEntry<E extends Slot, S extends Section>(
  groups: ReadonlyArray<Group<E, S>>,
  entryId: string,
  delta: -1 | 1,
): Array<Group<E, S>> {
  const gi = groups.findIndex((g) => g.entries.some((e) => e.id === entryId))
  if (gi < 0) return [...groups]
  const group = groups[gi]!
  const ei = group.entries.findIndex((e) => e.id === entryId)
  const sectionOf = (g: Group<E, S>) => g.section?.id ?? null
  const inside = group.entries[ei + delta]
  if (inside) {
    // Past a neighbour in the same group: before it going up, before the one after it going down.
    return delta === -1
      ? placeEntry(groups, entryId, sectionOf(group), inside.id)
      : placeEntry(groups, entryId, sectionOf(group), group.entries[ei + 2]?.id ?? null)
  }
  const neighbour = groups[gi + delta]
  if (!neighbour) return [...groups]
  return placeEntry(groups, entryId, sectionOf(neighbour), delta === -1 ? null : (neighbour.entries[0]?.id ?? null))
}

/** Moves a section one place up or down among the sections; the unsectioned group stays first. */
export function stepSection<E extends Slot, S extends Section>(
  groups: ReadonlyArray<Group<E, S>>,
  sectionId: string,
  delta: -1 | 1,
): Array<Group<E, S>> {
  const index = groups.findIndex((g) => g.section?.id === sectionId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= groups.length || groups[target]!.section === null) return [...groups]
  const next = [...groups]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

/** The entries in the order the band plays them, each with the name of its section (null when it has none). */
export function playOrder<E extends Slot, S extends Section>(
  groups: ReadonlyArray<Group<E, S>>,
): Array<{ entry: E; section: string | null }> {
  return groups.flatMap((g) => g.entries.map((entry) => ({ entry, section: g.section?.name ?? null })))
}
