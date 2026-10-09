import { Effect, Schema } from "effect"
import { sql } from "kysely"
import { Db, withSession } from "../db"

export class BandError extends Schema.TaggedError<BandError>()(
  "BandError",
  { message: Schema.String },
) {}

export const getUserBands = (sessionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    return yield* db.withTransaction(
      Effect.gen(function* () {
        yield* db.selectNoFrom([
          sql<string>`set_config('my.session_id', ${sessionId}, true)`.as("_"),
        ])
        const rows = yield* db
          .selectFrom("app_public.bands")
          .select(["id", "slug", "name", "description", "created_at"])
          .orderBy("name", "asc")
        return rows
      }),
    )
  })

export const getBandMembers = (sessionId: string, bandId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    return yield* withSession(db, sessionId,
      db
        .selectFrom("app_public.band_memberships")
        .innerJoin("app_public.users", "app_public.users.id", "app_public.band_memberships.user_id")
        .select([
          "app_public.band_memberships.id",
          "app_public.band_memberships.user_id",
          "app_public.band_memberships.is_owner",
          "app_public.band_memberships.created_at",
          "app_public.users.username",
          "app_public.users.name",
          "app_public.users.avatar_url",
        ])
        .where("app_public.band_memberships.band_id", "=", bandId)
        .orderBy("app_public.band_memberships.is_owner", "desc")
        .orderBy("app_public.users.username", "asc"),
    )
  })

export const createBand = (sessionId: string, args: { slug: string; name: string }) =>
  Effect.gen(function* () {
    const db = yield* Db
    return yield* withSession(db, sessionId, Effect.gen(function* () {
      const band = yield* db
        .selectFrom(
          sql<{ id: string; slug: string; name: string }>`app_public.create_band(
            slug => ${args.slug}::citext,
            name => ${args.name}
          )`.as("b"),
        )
        .selectAll()
        .pipe(
          Effect.head,
          Effect.catchTag("NoSuchElementException", () =>
            Effect.fail(new BandError({ message: "Failed to create band" })),
          ),
        )

      if (!band.id) return yield* Effect.fail(new BandError({ message: "Failed to create band" }))
      return { id: band.id, slug: band.slug, name: band.name }
    }))
  }).pipe(
    Effect.tapError((e) => Effect.logError("createBand failed", e)),
    Effect.catchAll((e) => {
      if (e._tag === "BandError") return Effect.fail(e)
      const msg = String(e)
      if (msg.includes("23505"))
        return Effect.fail(new BandError({ message: "A band with that slug already exists" }))
      return Effect.fail(new BandError({ message: msg }))
    }),
  )

export const inviteToBand = (
  sessionId: string,
  args: { bandId: string; username?: string; email?: string },
) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* withSession(db, sessionId,
      db.selectNoFrom([
        sql`app_public.invite_to_band(
          band_id => ${args.bandId}::uuid,
          username => ${args.username ?? null}::citext,
          email => ${args.email ?? null}::citext
        )`.as("_"),
      ]),
    )
  }).pipe(
    Effect.catchAll((e) => {
      const msg = String(e)
      if (msg.includes("LOGIN")) return Effect.fail(new BandError({ message: "You must be logged in" }))
      if (msg.includes("DNIED")) return Effect.fail(new BandError({ message: "You must be the band owner to invite" }))
      if (msg.includes("ISMBR")) return Effect.fail(new BandError({ message: "That person is already a member" }))
      if (msg.includes("NTFND")) return Effect.fail(new BandError({ message: "Could not find that person" }))
      return Effect.fail(new BandError({ message: "Failed to send invite" }))
    }),
  )

export const deleteBand = (sessionId: string, bandId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* withSession(db, sessionId,
      db.selectNoFrom([
        sql`app_public.delete_band(${bandId}::uuid)`.as("_"),
      ]),
    )
  })
