import { Context, Effect, Layer, Schema as S, Struct } from "effect"
import { RequestDatabase } from "../db"
import { Bands } from "./band"
import { Song, SongForbidden, type SongInsert, type SongUpdate } from "../../api/songs"
import { songCreate, songDelete, songFindByBandId, songFindById } from "../../../generated/queries.js"

const decodeSong = S.decodeUnknownEffect(Song)
const decodeSongs = S.decodeUnknownEffect(S.Array(Song))

/**
 * A band's song catalog, read and written as the request's user. Row-level
 * security scopes every query; the member checks turn "nothing visible" into a
 * 403 the browser can show.
 */
export class Songs extends Context.Service<Songs>()("giglist/Songs", {
  make: Effect.gen(function* () {
    const bands = yield* Bands

    const notMember = () => new SongForbidden({ message: "You are not a member of that band" })

    const requireMember = Effect.fnUntraced(function* (bandId: string) {
      if (!(yield* bands.isMember(bandId))) return yield* notMember()
    })

    /**
     * Reads the song, so a write can authorise its band before touching it.
     *
     * A song outside the caller's bands is not visible, so a missing row and a
     * foreign song look the same. Both are answered 403: a caller outside the
     * band must not learn the song exists.
     */
    const row = Effect.fnUntraced(function* (id: string) {
      const db = yield* RequestDatabase
      return yield* songFindById(db)({ id }).pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementError", () => Effect.fail(notMember())),
      )
    })

    const byId = Effect.fn("Songs.byId")(function* (id: string) {
      return yield* decodeSong(yield* row(id)).pipe(Effect.orDie)
    })

    const listByBand = Effect.fn("Songs.listByBand")(function* (bandId: string) {
      const db = yield* RequestDatabase
      yield* requireMember(bandId)
      return yield* songFindByBandId(db)({ band_id: bandId }).pipe(Effect.andThen(decodeSongs), Effect.orDie)
    })

    const create = Effect.fn("Songs.create")(function* (payload: typeof SongInsert.Type) {
      const db = yield* RequestDatabase
      yield* requireMember(payload.band_id)
      // The column default sets created_by to the caller.
      return yield* songCreate(db)({ ...payload }).pipe(Effect.head, Effect.andThen(decodeSong), Effect.orDie)
    })

    const update = Effect.fn("Songs.update")(function* (id: string, payload: typeof SongUpdate.Type) {
      const db = yield* RequestDatabase
      const existing = yield* row(id)
      yield* requireMember(existing.band_id)
      // Not the generated songUpdate: it also writes band_id and created_by,
      // and the visitor role may update only the song's own fields. The where
      // clause plus the update policy do the scoping. An empty SET is not
      // valid SQL, and an empty payload changes nothing.
      if (Struct.keys(payload).length === 0) return yield* decodeSong(existing).pipe(Effect.orDie)
      return yield* db
        .updateTable("app_public.songs")
        .set(payload)
        .where("id", "=", id)
        .returningAll()
        .pipe(Effect.head, Effect.andThen(decodeSong), Effect.orDie)
    })

    const remove = Effect.fn("Songs.remove")(function* (id: string) {
      const db = yield* RequestDatabase
      const existing = yield* row(id)
      yield* requireMember(existing.band_id)
      yield* songDelete(db)({ id }).pipe(Effect.orDie)
    })

    return { byId, listByBand, create, update, remove }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Bands.layer))
}
