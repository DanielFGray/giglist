import { Schema as S, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { SessionMiddleware } from "./session"

// --- Songs schemas ---

/**
 * The keys the `app_public.musical_key` domain accepts, spelled out because the
 * schema uses a text domain with a check constraint rather than an enum. A value
 * outside this list fails here as a 400, instead of reaching the database and
 * coming back as a domain violation.
 */
const keys = [
  "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb",
  "G", "G#", "Ab", "A", "A#", "Bb", "B",
  "Cm", "C#m", "Dbm", "Dm", "D#m", "Ebm", "Em", "Fm", "F#m", "Gbm",
  "Gm", "G#m", "Abm", "Am", "A#m", "Bbm", "Bm",
] as const

export const MusicalKeys = keys

export type MusicalKeyType = S.Schema.Type<typeof musicalKey>

export const musicalKey = S.Literals([...keys])

/*
 * Wire schemas for the song catalog, declared here rather than taken from
 * generated/song.ts: that module imports src/server/db.ts, so bringing its
 * schemas into the contract would pull @effect/sql-pg into the browser bundle.
 * The server decodes database rows into these before responding.
 */
export const Song = S.Struct({
  id: S.String.check(S.isUUID()),
  band_id: S.String.check(S.isUUID()),
  title: S.String,
  artist: S.NullOr(S.String),
  key: S.NullOr(musicalKey),
  tempo_bpm: S.NullOr(S.Finite),
  duration_seconds: S.NullOr(S.Finite),
  capo: S.NullOr(S.Finite),
  notes: S.NullOr(S.String),
  created_by: S.NullOr(S.String.check(S.isUUID())),
  created_at: S.Date,
  updated_at: S.Date,
})

export const SongInsert = S.Struct({
  band_id: S.String.check(S.isUUID()),
  title: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(500))),
  artist: S.NullOr(S.String),
  key: S.NullOr(musicalKey),
  tempo_bpm: S.NullOr(S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0)), S.check(S.isLessThanOrEqualTo(999)))),
  duration_seconds: S.NullOr(
    S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0)), S.check(S.isLessThanOrEqualTo(86400))),
  ),
  capo: S.NullOr(S.Finite.pipe(S.check(S.isGreaterThanOrEqualTo(0)), S.check(S.isLessThanOrEqualTo(12)))),
  notes: S.NullOr(S.String.pipe(S.check(S.isMaxLength(10000)))),
})

/**
 * The fields to change; an absent field keeps its value. A grid cell sends only
 * its own field, so two people editing different cells of one song both land.
 */
/** A song's own fields: everything a band can set on it. */
export const SongFields = Struct.omit(SongInsert.fields, ["band_id"])

export const SongUpdate = S.Struct(Struct.map(SongFields, S.optionalKey))


/**
 * Declared here instead of importing the generated group, which maps its reads
 * onto bare `GET /:param` paths; the Effect router rejects the resulting
 * duplicate route and the server fails to start. Spelling the paths out also
 * lets a band's catalog (`GET /band/:bandId`) and one song (`GET /:id`) coexist.
 * Only the URLs are re-declared — the handler's queries come from
 * generated/queries.ts, and the lookup by id happens inside the handler, which
 * needs the song row to authorise its band anyway.
 */
export class SongForbidden extends S.TaggedError<SongForbidden, { readonly brand: unique symbol }>()("SongForbidden", { message: S.String }, { httpApiStatus: 403 }) {}

export const SongsApiGroup = HttpApiGroup.make("songs")
  .add(
    HttpApiEndpoint.get("songFindById", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      success: Song,
      error: SongForbidden,
    }),
  )
  .add(
    HttpApiEndpoint.get("songFindByBandId", "/band/:bandId", {
      params: { bandId: S.String.check(S.isUUID()) },
      success: S.Array(Song),
      error: SongForbidden,
    }),
  )
  .add(
    HttpApiEndpoint.post("songCreate", "/", {
      payload: SongInsert,
      success: Song.pipe(HttpApiSchema.status(201)),
      error: SongForbidden,
    }),
  )
  .add(
    HttpApiEndpoint.put("songUpdate", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      payload: SongUpdate,
      success: Song,
      error: SongForbidden,
    }),
  )
  .add(
    HttpApiEndpoint.delete("songDelete", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      error: SongForbidden,
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/songs")
