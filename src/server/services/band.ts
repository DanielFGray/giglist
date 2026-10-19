import { Effect, Schema } from "effect";
import { sql } from "kysely";
import { Kysely } from "../db";

export class BandError extends Schema.TaggedError<BandError, { readonly brand: unique symbol }>()("BandError", {
  message: Schema.String,
}) {}

/**
 * Bands the current user belongs to.
 *
 * The membership join is a convenience, not the security boundary: the visitor
 * role has only `select` on bands, and the `select_member` policy allows a row
 * only when the user is a member. Both mechanisms agree, so the join only keeps
 * the result to one query for the common case.
 */
export const getUserBands = Effect.fnUntraced(function* () {
  const db = yield* Kysely;
  return yield* db
    .selectFrom("app_public.band_memberships")
    .innerJoin("app_public.bands", "app_public.bands.id", "app_public.band_memberships.band_id")
    .select([
      "app_public.bands.id",
      "app_public.bands.slug",
      "app_public.bands.name",
      "app_public.bands.description",
      "app_public.bands.show_members_publicly",
      "app_public.bands.show_gig_dates_publicly",
      "app_public.bands.created_at",
    ])
    .where("app_public.band_memberships.user_id", "=", sql<string>`app_public.current_user_id()`)
    .orderBy("app_public.bands.name", "asc");
});

export const getBandMembers = Effect.fnUntraced(function* (bandId: string) {
  const db = yield* Kysely;
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
    .orderBy("app_public.users.username", "asc");
});

export const createBand = Effect.fnUntraced(
  function* (args: { slug: string; name: string }) {
    const db = yield* Kysely;
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
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(new BandError({ message: "Failed to create band" })),
        ),
      );

    if (!band.id) return yield* new BandError({ message: "Failed to create band" });
    return { id: band.id, slug: band.slug, name: band.name };
  },
  Effect.tapError((e) => Effect.logError("createBand failed", e)),
  Effect.catch((e) => {
    if (e._tag === "BandError") return Effect.fail(e);
    const msg = String(e);
    if (msg.includes("23505"))
      return Effect.fail(new BandError({ message: "A band with that slug already exists" }));
    return Effect.fail(new BandError({ message: msg }));
  }),
);

export const inviteToBand = Effect.fnUntraced(
  function* (args: { bandId: string; username?: string; email?: string }) {
    const db = yield* Kysely;
    yield* db.selectNoFrom([
      sql`app_public.invite_to_band(
        band_id => ${args.bandId}::uuid,
        username => ${args.username ?? null}::citext,
        email => ${args.email ?? null}::citext
      )`.as("_"),
    ]);
  },
  Effect.catch((e) => {
    const msg = String(e);
    if (msg.includes("LOGIN"))
      return Effect.fail(new BandError({ message: "You must be logged in" }));
    if (msg.includes("DNIED"))
      return Effect.fail(new BandError({ message: "You must be the band owner to invite" }));
    if (msg.includes("ISMBR"))
      return Effect.fail(new BandError({ message: "That person is already a member" }));
    if (msg.includes("NTFND"))
      return Effect.fail(new BandError({ message: "Could not find that person" }));
    return Effect.fail(new BandError({ message: "Failed to send invite" }));
  }),
);

/** The invitations addressed to the current user. */
export const listInvitations = Effect.fnUntraced(function* () {
  const db = yield* Kysely;
  return yield* db
    .selectFrom(sql<{ id: string; band_id: string; band_name: string }>`app_public.my_band_invitations()`.as("i"))
    .selectAll();
});

export const acceptInvitation = Effect.fnUntraced(
  function* (invitationId: string) {
    const db = yield* Kysely;
    yield* db.selectNoFrom([sql`app_public.accept_invitation_to_band(${invitationId}::uuid)`.as("_")]);
  },
  Effect.catch((e) => {
    const msg = String(e);
    if (msg.includes("NTFND")) return Effect.fail(new BandError({ message: "That invitation no longer exists" }));
    if (msg.includes("DNIED")) return Effect.fail(new BandError({ message: "That invitation is not for you" }));
    return Effect.fail(new BandError({ message: "Could not accept the invitation" }));
  }),
);

export const declineInvitation = Effect.fnUntraced(
  function* (invitationId: string) {
    const db = yield* Kysely;
    yield* db.selectNoFrom([sql`app_public.decline_invitation_to_band(${invitationId}::uuid)`.as("_")]);
  },
  Effect.mapError(() => new BandError({ message: "Could not decline the invitation" })),
);

export const deleteBand = Effect.fnUntraced(
  function* (bandId: string) {
    const db = yield* Kysely;
    const mine = yield* db
      .selectFrom("app_public.band_memberships")
      .select(["is_owner"])
      .where("band_id", "=", bandId)
      .where("user_id", "=", sql<string>`app_public.current_user_id()`)
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(new BandError({ message: "You are not a member of that band" })),
        ),
      );
    if (!mine.is_owner) {
      return yield* new BandError({ message: "Only the owner can delete the band" });
    }
    yield* db.selectNoFrom([sql`app_public.delete_band(${bandId}::uuid)`.as("_")]);
  },
  Effect.catch((e) => {
    if (e._tag === "BandError") return Effect.fail(e);
    return Effect.fail(new BandError({ message: "Could not delete the band" }));
  }),
);

export const updateBand = Effect.fnUntraced(
  function* (args: {
    bandId: string;
    description?: string | null;
    show_members_publicly?: boolean;
    show_gig_dates_publicly?: boolean;
  }) {
    const db = yield* Kysely;
    const mine = yield* db
      .selectFrom("app_public.band_memberships")
      .select(["is_owner"])
      .where("band_id", "=", args.bandId)
      .where("user_id", "=", sql<string>`app_public.current_user_id()`)
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(new BandError({ message: "You are not a member of that band" })),
        ),
      );
    if (!mine.is_owner) {
      return yield* new BandError({ message: "Only the owner can update the band" });
    }

    const patch: {
      description?: string | null;
      show_members_publicly?: boolean;
      show_gig_dates_publicly?: boolean;
    } = {};
    if (args.description !== undefined) patch.description = args.description;
    if (args.show_members_publicly !== undefined)
      patch.show_members_publicly = args.show_members_publicly;
    if (args.show_gig_dates_publicly !== undefined)
      patch.show_gig_dates_publicly = args.show_gig_dates_publicly;

    if (Object.keys(patch).length === 0) {
      return yield* db
        .selectFrom("app_public.bands")
        .select([
          "id",
          "slug",
          "name",
          "description",
          "show_members_publicly",
          "show_gig_dates_publicly",
          "created_at",
        ])
        .where("id", "=", args.bandId)
        .pipe(
          Effect.head,
          Effect.catchTag("NoSuchElementError", () =>
            Effect.fail(new BandError({ message: "Band not found" })),
          ),
        );
    }

    return yield* db
      .updateTable("app_public.bands")
      .set(patch)
      .where("id", "=", args.bandId)
      .returning([
        "id",
        "slug",
        "name",
        "description",
        "show_members_publicly",
        "show_gig_dates_publicly",
        "created_at",
      ])
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(new BandError({ message: "Band not found" })),
        ),
      );
  },
  Effect.catch((e) => {
    if (e._tag === "BandError") return Effect.fail(e);
    return Effect.fail(new BandError({ message: "Could not update the band" }));
  }),
);

export class PublicBandMissing extends Schema.TaggedError<
  PublicBandMissing,
  { readonly brand: unique symbol }
>()("PublicBandMissing", { slug: Schema.String }) {}

/** Public profile for a slug; runs as the visitor (including signed-out). */
export const getPublicBandProfile = Effect.fnUntraced(function* (slug: string) {
  const db = yield* Kysely;
  const band = yield* db
    .selectFrom("app_public.bands")
    .select([
      "slug",
      "name",
      "description",
      "show_members_publicly",
      "show_gig_dates_publicly",
    ])
    .where("slug", "=", slug)
    .pipe(
      Effect.head,
      Effect.catchTag("NoSuchElementError", () =>
        Effect.fail(new PublicBandMissing({ slug })),
      ),
    );

  const members = band.show_members_publicly
    ? yield* db
        .selectFrom(
          sql<{
            username: string;
            name: string | null;
            avatar_url: string | null;
            is_owner: boolean;
          }>`app_public.public_band_members(${slug}::citext)`.as("m"),
        )
        .selectAll()
    : [];

  const gigs = band.show_gig_dates_publicly
    ? yield* db
        .selectFrom(
          sql<{ name: string; gig_date: Date | string }>`app_public.public_band_gig_dates(${slug}::citext)`.as(
            "g",
          ),
        )
        .selectAll()
    : [];

  return {
    slug: band.slug,
    name: band.name,
    description: band.description ?? null,
    show_members_publicly: band.show_members_publicly,
    show_gig_dates_publicly: band.show_gig_dates_publicly,
    members: members.map((m) => ({
      username: m.username,
      name: m.name ?? null,
      avatar_url: m.avatar_url ?? null,
      is_owner: m.is_owner,
    })),
    gigs: gigs.map((g) => ({
      name: g.name,
      gig_date:
        typeof g.gig_date === "string"
          ? g.gig_date.slice(0, 10)
          : g.gig_date.toISOString().slice(0, 10),
    })),
  };
});

export const transferOwnership = Effect.fnUntraced(
  function* (args: { bandId: string; userId: string }) {
    const db = yield* Kysely;
    const band = yield* db
      .selectFrom(
        sql<{ id: string }>`app_public.transfer_band_ownership(
          ${args.bandId}::uuid,
          ${args.userId}::uuid
        )`.as("b"),
      )
      .selectAll()
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(
            new BandError({
              message: "Could not transfer ownership — you must be the owner and the person a member",
            }),
          ),
        ),
      );
    if (!band.id) {
      return yield* new BandError({
        message: "Could not transfer ownership — you must be the owner and the person a member",
      });
    }
  },
  Effect.catch((e) => {
    if (e._tag === "BandError") return Effect.fail(e);
    return Effect.fail(new BandError({ message: "Could not transfer ownership" }));
  }),
);

/**
 * Leave a band. An owner with other members must name `transferTo` so ownership
 * moves first; the sole owner must delete the band instead.
 */
export const leaveBand = Effect.fnUntraced(
  function* (args: { bandId: string; transferTo: string | undefined }) {
    const db = yield* Kysely;
    const me = yield* db
      .selectFrom("app_public.band_memberships")
      .select(["user_id", "is_owner"])
      .where("band_id", "=", args.bandId)
      .where("user_id", "=", sql<string>`app_public.current_user_id()`)
      .pipe(
        Effect.head,
        Effect.catchTag("NoSuchElementError", () =>
          Effect.fail(new BandError({ message: "You are not a member of that band" })),
        ),
      );

    if (me.is_owner) {
      const others = yield* db
        .selectFrom("app_public.band_memberships")
        .select(["user_id"])
        .where("band_id", "=", args.bandId)
        .where("user_id", "<>", me.user_id);
      if (others.length === 0) {
        return yield* new BandError({
          message: "You are the only member — delete the band to remove its data",
        });
      }
      if (args.transferTo === undefined) {
        return yield* new BandError({
          message: "Choose a member to take ownership before you leave",
        });
      }
      if (!others.some((m) => m.user_id === args.transferTo)) {
        return yield* new BandError({ message: "That person is not a member of this band" });
      }
      yield* transferOwnership({ bandId: args.bandId, userId: args.transferTo });
    }

    yield* db.selectNoFrom([
      sql`app_public.remove_from_band(
        ${args.bandId}::uuid,
        ${me.user_id}::uuid
      )`.as("_"),
    ]);
  },
  Effect.catch((e) => {
    if (e._tag === "BandError") return Effect.fail(e);
    return Effect.fail(new BandError({ message: "Could not leave the band" }));
  }),
);
