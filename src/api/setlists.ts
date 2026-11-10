import { Schema as S } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { uuid } from "./fields"
import { SessionMiddleware } from "./session"
import { musicalKey } from "./songs"

// --- Setlists schemas ---

export const SetlistStatus = S.Literals(["draft", "rehearsal", "final"])

export type SetlistStatusType = S.Schema.Type<typeof SetlistStatus>


const SetlistName = S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200)))

/** A gig that plays a setlist: enough to name it (see `gigLabel`) and link to it. */
export const GigRef = S.Struct({
  id: uuid,
  venue: S.NullOr(S.String),
  /** `YYYY-MM-DD`, or null when the gig has no date yet. */
  gig_date: S.NullOr(S.String),
})

/** A named, ordered list of songs. `gigs` are the gigs that play it, soonest first: an edit reaches all of them. */
export const Setlist = S.Struct({
  id: uuid,
  band_id: uuid,
  name: S.String,
  status: SetlistStatus,
  gigs: S.Array(GigRef),
  /** How many songs, and their summed durations (songs without one count as 0). */
  song_count: S.Finite,
  duration_seconds: S.Finite,
  created_at: S.Date,
  updated_at: S.Date,
})

export const SetlistInsert = S.Struct({
  band_id: uuid,
  name: SetlistName,
})

export const SetlistUpdate = S.Struct({
  name: S.optionalKey(SetlistName),
  status: S.optionalKey(SetlistStatus),
})

/** A copy takes the songs and their overrides; it plays in no gig until one adds it. */
export const SetlistCopy = S.Struct({
  name: SetlistName,
})

/**
 * One song in a setlist, as `app_public.setlist_entries_resolved` returns it:
 * the entry's own fields with the song's defaults filled in, and a flag per
 * field saying whether the entry overrides it.
 */
export const SetlistEntry = S.Struct({
  id: uuid,
  setlist_id: uuid,
  song_id: uuid,
  position_key: S.String,
  title: S.String,
  artist: S.NullOr(S.String),
  key: S.NullOr(musicalKey),
  tempo_bpm: S.NullOr(S.Finite),
  notes: S.NullOr(S.String),
  duration_seconds: S.NullOr(S.Finite),
  capo: S.NullOr(S.Finite),
  key_overridden: S.Boolean,
  tempo_overridden: S.Boolean,
  notes_overridden: S.Boolean,
})

/** A new entry plays last. */
export const SetlistEntryInsert = S.Struct({
  song_id: uuid,
})

/**
 * The fields to change; an absent field keeps its value. A null override means
 * "inherit the song's value". `song_id` puts another song of the band in this
 * place, keeping the overrides.
 */
export const SetlistEntryUpdate = S.Struct({
  song_id: S.optionalKey(uuid),
  key_override: S.optionalKey(S.NullOr(musicalKey)),
  tempo_override: S.optionalKey(
    S.NullOr(S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(1)), S.check(S.isLessThanOrEqualTo(999)))),
  ),
  notes_override: S.optionalKey(S.NullOr(S.String.pipe(S.check(S.isMaxLength(10000))))),
})

/** One reorder: `id` goes right after `previous`, or first when `previous` is null. The server resolves keys inside the write. */
export const Move = S.Struct({
  id: uuid,
  previous: S.NullOr(uuid),
})

/** Someone with a setlist or a gig open: reading it, or performing it from song number `at`. */
export const LiveViewer = S.Struct({
  client: uuid,
  username: S.String,
  mode: S.Literals(["viewing", "performing"]),
  at: S.NullOr(S.Finite),
})

/**
 * What a setlist's or a gig's event stream carries. `changed` says it was
 * written and by whom, and holds no data: a listener fetches the new state
 * through the ordinary endpoints, so row-level security decides what it sees.
 * `presence` is the full list of viewers each time it changes. `ping` keeps an
 * idle connection alive and lets a client notice a dead one.
 */
export const LiveEvent = S.Union([
  S.Struct({ kind: S.Literal("changed"), by: S.NullOr(S.String) }),
  S.Struct({ kind: S.Literal("presence"), viewers: S.Array(LiveViewer) }),
  S.Struct({ kind: S.Literal("ping") }),
])

export const LivePresence = S.Struct({
  client: uuid,
  mode: LiveViewer.fields.mode,
  at: LiveViewer.fields.at,
})

export class SetlistForbidden extends S.TaggedError<
  SetlistForbidden,
  { readonly brand: unique symbol }
>()("SetlistForbidden", { message: S.String }) {}

export class SetlistNotFound extends S.TaggedError<
  SetlistNotFound,
  { readonly brand: unique symbol }
>()("SetlistNotFound", { id: uuid }) {}

const setlistErrors = [
  SetlistNotFound.pipe(HttpApiSchema.status(404)),
  SetlistForbidden.pipe(HttpApiSchema.status(403)),
]

export const SetlistsApiGroup = HttpApiGroup.make("setlists")
  .add(
    HttpApiEndpoint.get("listSetlists", "/band/:bandId", {
      params: { bandId: uuid },
      success: S.Array(Setlist),
      error: SetlistForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(
    HttpApiEndpoint.post("createSetlist", "/", {
      payload: SetlistInsert,
      success: Setlist.pipe(HttpApiSchema.status(201)),
      error: SetlistForbidden.pipe(HttpApiSchema.status(403)),
    }),
  )
  .add(HttpApiEndpoint.get("getSetlist", "/:id", { params: { id: uuid }, success: Setlist, error: setlistErrors }))
  .add(
    HttpApiEndpoint.put("updateSetlist", "/:id", {
      params: { id: uuid },
      payload: SetlistUpdate,
      success: Setlist,
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("copySetlist", "/:id/copy", {
      params: { id: uuid },
      payload: SetlistCopy,
      success: Setlist.pipe(HttpApiSchema.status(201)),
      error: setlistErrors,
    }),
  )
  .add(HttpApiEndpoint.delete("deleteSetlist", "/:id", { params: { id: uuid }, error: setlistErrors }))
  .add(
    HttpApiEndpoint.get("listEntries", "/:id/entries", {
      params: { id: uuid },
      success: S.Array(SetlistEntry),
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("addEntry", "/:id/entries", {
      params: { id: uuid },
      payload: SetlistEntryInsert,
      success: SetlistEntry.pipe(HttpApiSchema.status(201)),
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.put("updateEntry", "/:id/entries/:entryId", {
      params: { id: uuid, entryId: uuid },
      payload: SetlistEntryUpdate,
      success: SetlistEntry,
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteEntry", "/:id/entries/:entryId", {
      params: { id: uuid, entryId: uuid },
      error: setlistErrors,
    }),
  )
  .add(HttpApiEndpoint.put("move", "/:id/move", { params: { id: uuid }, payload: Move, error: setlistErrors }))
  .add(
    HttpApiEndpoint.get("watchSetlist", "/:id/events", {
      params: { id: uuid },
      query: { client: uuid },
      success: HttpApiSchema.StreamSse({ data: LiveEvent }),
      error: setlistErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("reportPresence", "/:id/presence", {
      params: { id: uuid },
      payload: LivePresence,
      error: setlistErrors,
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/setlists")
