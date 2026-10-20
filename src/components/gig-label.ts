import { formatGigDate } from "./time"

/**
 * What the app calls a gig. A gig has no name of its own: it goes by its
 * venue, or by its date when the band has not named a venue.
 */
export const gigLabel = (gig: { venue: string | null; gig_date: string | null }, locale?: string): string =>
  gig.venue ?? (gig.gig_date === null ? "Undated gig" : formatGigDate(gig.gig_date, locale))

/**
 * Gigs split for the band's list: upcoming ones soonest first, then the ones
 * without a date yet, and past ones most recent first. `today` is the
 * `YYYY-MM-DD` of the person reading, so a gig tonight is still upcoming.
 */
export function splitGigs<G extends { gig_date: string | null }>(
  gigs: ReadonlyArray<G>,
  today: string,
): { upcoming: Array<G>; past: Array<G> } {
  const dated = gigs.flatMap((gig) => (gig.gig_date === null ? [] : [{ gig, date: gig.gig_date }]))
  const upcoming = dated.filter(({ date }) => date >= today).toSorted((a, b) => a.date.localeCompare(b.date))
  const past = dated.filter(({ date }) => date < today).toSorted((a, b) => b.date.localeCompare(a.date))
  const undated = gigs.filter((gig) => gig.gig_date === null)
  return { upcoming: [...upcoming.map(({ gig }) => gig), ...undated], past: past.map(({ gig }) => gig) }
}

/** Today's date where the reader is, as `YYYY-MM-DD`. */
export const localToday = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
