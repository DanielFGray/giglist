import { Effect, Schema } from "effect"
import { sql } from "kysely"
import { Kysely } from "../db"

export class BandError extends Schema.TaggedError<BandError>()(
  "BandError",
  { message: Schema.String },
) {}

/**
 * Bands the current user belongs to.
 *
 * The membership join is a convenience, not the security boundary: the visitor
 * role has only `select` on bands, and the `select_member` policy allows a row
 * only when the user is a member. Both mechanisms agree, so the join only keeps
 * the result to one query for the common case.
 */
export const getUserBands = () =>
  Effect.gen(function* () {
    const db = yield* Kysely
    return yield* db
      .selectFrom("app_public.band_memberships")
      .innerJoin(
        "app_public.bands",
        "app_public.bands.id",
        "app_public.band_memberships.band_id",
      )
      .select([
        "app_public.bands.id",
        "app_public.bands.slug",
        "app_public.bands.name",
        "app_public.bands.description",
        "app_public.bands.created_at",
      ])
      .where(
        "app_public.band_memberships.user_id",
        "=",
        sql<string>`app_public.current_user_id()`,
      )
      .orderBy("app_public.bands.name", "asc")
  })

export const getBandMembers = (bandId: string) =>
  Effect.gen(function* () {
    const db = yield* Kysely
    return yield* db
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
      .orderBy("app_public.users.username", "asc")
  })

export const createBand = (args: { slug: string; name: string }) =>
  Effect.gen(function* () {
    const db = yield* Kysely
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
  args: { bandId: string; username?: string; email?: string },
) =>
  Effect.gen(function* () {
    const db = yield* Kysely
    yield* db.selectNoFrom([
      sql`app_public.invite_to_band(
        band_id => ${args.bandId}::uuid,
        username => ${args.username ?? null}::citext,
        email => ${args.email ?? null}::citext
      )`.as("_"),
    ])
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

export const deleteBand = (bandId: string) =>
  Effect.gen(function* () {
    const db = yield* Kysely
    yield* db.selectNoFrom([
      sql`app_public.delete_band(${bandId}::uuid)`.as("_"),
    ])
  })
