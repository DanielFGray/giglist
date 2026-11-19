import { Context, Effect, Layer, Schema as S, Struct } from "effect"
import { requestDb } from "../db"
import { Bands } from "./bands"
import { Song, type SongInsert, type SongUpdate } from "../../api/songs"

export class SongRefused extends S.TaggedError<SongRefused, { readonly brand: unique symbol }>()("SongRefused", {
  message: S.String,
}) {}

/**
 * A band's song catalog, read and written as the request's user. Row-level
 * security scopes every query; the member checks turn "nothing visible" into a
 * 403 the browser can show.
 */
export class Songs extends Context.Service<Songs>()("giglist/songs", {
  make: Effect.gen(function* () {
    const bands = yield* Bands

    const notMember = () => new SongRefused({ message: "You are not a member of that band" })

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
      const found = yield* requestDb.maybe(Song, (k) =>
        k.selectFrom("app_public.songs").selectAll().where("id", "=", id),
      )
      return yield* Effect.fromOption(found, notMember)
    })

    const byId = Effect.fn("Songs.byId")(function* (id: string) {
      return yield* row(id)
    })

    const listByBand = Effect.fn("Songs.listByBand")(function* (bandId: string) {
      yield* requireMember(bandId)
      return yield* requestDb.all(Song, (k) =>
        k.selectFrom("app_public.songs").selectAll().where("band_id", "=", bandId),
      )
    })

    const create = Effect.fn("Songs.create")(function* (payload: typeof SongInsert.Type) {
      yield* requireMember(payload.band_id)
      // The column default sets created_by to the caller.
      return yield* requestDb.one(Song, (k) =>
        k
          .insertInto("app_public.songs")
          .values({ ...payload })
          .returningAll(),
      )
    })

    const update = Effect.fn("Songs.update")(function* (id: string, payload: typeof SongUpdate.Type) {
      const existing = yield* row(id)
      yield* requireMember(existing.band_id)
      // The visitor role may update only the song's own fields; the where
      // clause plus the update policy do the scoping. An empty SET is not
      // valid SQL, and an empty payload changes nothing.
      if (Struct.keys(payload).length === 0) return existing
      return yield* requestDb.one(Song, (k) =>
        k.updateTable("app_public.songs").set(payload).where("id", "=", id).returningAll(),
      )
    })

    const remove = Effect.fn("Songs.remove")(function* (id: string) {
      const existing = yield* row(id)
      yield* requireMember(existing.band_id)
      yield* requestDb.exec((k) => k.deleteFrom("app_public.songs").where("id", "=", id))
    })

    return { byId, listByBand, create, update, remove }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Bands.layer))
}
