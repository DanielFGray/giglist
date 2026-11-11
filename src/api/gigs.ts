import { Schema as S } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { uuid } from "./fields"
import { SessionMiddleware } from "./session"
import { GigRef, LiveEvent, LivePresence, Move, SetlistCopy, SetlistEntry, SetlistForbidden } from "./setlists"

// --- Gigs schemas ---

/**
 * A wall-clock time at the venue on the gig date, `HH:MM` (the database may
 * answer `HH:MM:SS`). No time zone is stored: the gig date and the venue's
 * local time are all a band needs to know when to show up.
 */
const GigTime = S.NullOr(
  S.String.pipe(S.check(S.isPattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/))),
)

/** A setlist as a gig plays it, in the gig's order. `gig_count` counts every gig that plays it, this one included. */
export const GigSetlist = S.Struct({
  id: uuid,
  name: S.String,
  song_count: S.Finite,
  duration_seconds: S.Finite,
  gig_count: S.Finite,
})

/** One performance. It has no name: `gigLabel` names it by venue, or by date. */
export const Gig = S.Struct({
  ...GigRef.fields,
  band_id: uuid,
  address: S.NullOr(S.String),
  load_in_time: GigTime,
  performance_time: GigTime,
  /** For the band only. */
  notes: S.NullOr(S.String),
  setlists: S.Array(GigSetlist),
  created_at: S.Date,
  updated_at: S.Date,
})

export const GigDetails = S.Struct({
  venue: S.NullOr(S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200)))),
  gig_date: S.NullOr(S.String.pipe(S.check(S.isPattern(/^\d{4}-\d{2}-\d{2}$/)))),
  address: S.NullOr(S.String.pipe(S.check(S.isMaxLength(1000)))),
  load_in_time: GigTime,
  performance_time: GigTime,
  notes: S.NullOr(S.String.pipe(S.check(S.isMaxLength(5000)))),
})

export const GigInsert = S.Struct({
  band_id: uuid,
  ...GigDetails.fields,
})

/** A setlist the gig starts playing, after the ones it already plays. */
export const GigSetlistInsert = S.Struct({
  setlist_id: uuid,
})

/** One song of a gig, in play order: an entry of one of its setlists. */
export const GigEntry = S.Struct({
  ...SetlistEntry.fields,
  setlist_name: S.String,
})

export class GigNotFound extends S.TaggedError<GigNotFound, { readonly brand: unique symbol }>()("GigNotFound", {
  id: uuid,
}) {}

const gigErrors = [
  GigNotFound.pipe(HttpApiSchema.status(404)),
  SetlistForbidden.pipe(HttpApiSchema.status(403)),
]

export const GigsApiGroup = HttpApiGroup.make("gigs")
  .add(
    HttpApiEndpoint.get("listGigs", "/band/:bandId", {
      params: { bandId: uuid },
      success: S.Array(Gig),
      error: SetlistForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.post("createGig", "/", {
      payload: GigInsert,
      success: Gig.pipe(HttpApiSchema.status(201)),
      error: SetlistForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(HttpApiEndpoint.get("getGig", "/:id", { params: { id: uuid }, success: Gig, error: gigErrors }))
  .add(
    HttpApiEndpoint.put("updateGig", "/:id", {
      params: { id: uuid },
      payload: GigDetails,
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(HttpApiEndpoint.delete("deleteGig", "/:id", { params: { id: uuid }, error: gigErrors }))
  .add(
    HttpApiEndpoint.post("addGigSetlist", "/:id/setlists", {
      params: { id: uuid },
      payload: GigSetlistInsert,
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("removeGigSetlist", "/:id/setlists/:setlistId", {
      params: { id: uuid, setlistId: uuid },
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(
    // The gig plays a new copy of the setlist in its place; other gigs keep the original.
    HttpApiEndpoint.post("copyGigSetlist", "/:id/setlists/:setlistId/copy", {
      params: { id: uuid, setlistId: uuid },
      payload: SetlistCopy,
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.put("moveGigSetlist", "/:id/setlists/move", {
      params: { id: uuid },
      payload: Move,
      success: Gig,
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("listGigEntries", "/:id/entries", {
      params: { id: uuid },
      success: S.Array(GigEntry),
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("watchGig", "/:id/events", {
      params: { id: uuid },
      query: { client: uuid },
      success: HttpApiSchema.StreamSse({ data: LiveEvent }),
      error: gigErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportGigPresence", "/:id/presence", {
      params: { id: uuid },
      payload: LivePresence,
      error: gigErrors,
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/gigs")
