import { Context, Effect, Layer, Schema } from "effect";
import { sql } from "kysely";
import { RequestDatabase } from "../db";
import type { UpdateBandPayload } from "../../api/bands"
;
import { pgError } from "./pg-error";

type BandUpdate = Schema.Schema.Type<typeof UpdateBandPayload>;

export class BandError extends Schema.TaggedError<BandError, { readonly brand: unique symbol }>()("BandError", {
  message: Schema.String,
}) {}

export class PublicBandMissing extends Schema.TaggedError<
  PublicBandMissing,
  { readonly brand: unique symbol }
>()("PublicBandMissing", { slug: Schema.String }) {}

/** The columns of a band its members read; `BandInfo` in the contract has the same fields. */
const bandColumns = [
  "app_public.bands.id",
  "app_public.bands.slug",
  "app_public.bands.name",
  "app_public.bands.description",
  "app_public.bands.is_public",
  "app_public.bands.show_members_publicly",
  "app_public.bands.show_gig_dates_publicly",
  "app_public.bands.show_songs_publicly",
  "app_public.bands.page_theme",
  "app_public.bands.page_options",
  "app_public.bands.created_at",
] as const;

/**
 * Band reads and writes, each run on the request's connection, `RequestDatabase`.
 * The methods yield it themselves rather than capturing one at layer build,
 * because only `withAuthContext` provides it, once per request.
 */
export class Bands extends Context.Service<Bands>()("setlist/Bands", {
  make: Effect.sync(() => {
    /** Owner-only: moves ownership to another member, failing with a BandError when either side is wrong. */
    const transferOwnership = Effect.fn("Bands.transferOwnership")(
      function* (args: { bandId: string; userId: string }) {
        const db = yield* RequestDatabase;
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
      Effect.catchIf(
        (e): e is Exclude<typeof e, BandError> => e._tag !== "BandError",
        (e) => Effect.logError("Could not transfer ownership", e).pipe(Effect.andThen(Effect.fail(new BandError({ message: "Could not transfer ownership" })))),
      ),
    );

    /**
     * Bands the current user belongs to.
     *
     * The membership join is a convenience, not the security boundary: the visitor
     * role has only `select` on bands, and the `select_member` policy allows a row
     * only when the user is a member. Both mechanisms agree, so the join only keeps
     * the result to one query for the common case. The public page reads bands
     * through `app_public.public_band`, never through a policy.
     */
    const getUserBands = Effect.fn("Bands.getUserBands")(function* () {
      const db = yield* RequestDatabase;
      return yield* db
        .selectFrom("app_public.band_memberships")
        .innerJoin("app_public.bands", "app_public.bands.id", "app_public.band_memberships.band_id")
        .select(bandColumns)
        .where("app_public.band_memberships.user_id", "=", sql<string>`app_public.current_user_id()`)
        .orderBy("app_public.bands.name", "asc");
    });

    const getBandMembers = Effect.fn("Bands.getBandMembers")(function* (bandId: string) {
      const db = yield* RequestDatabase;
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

    const createBand = Effect.fn("Bands.createBand")(
      function* (args: { slug: string; name: string }) {
        const db = yield* RequestDatabase;
        const created = yield* db
          .selectFrom(
            sql<{ id: string | null }>`app_public.create_band(
              slug => ${args.slug}::citext,
              name => ${args.name}
            )`.as("b"),
          )
          .select("id")
          .pipe(
            Effect.head,
            Effect.catchTag("NoSuchElementError", () =>
              Effect.fail(new BandError({ message: "Failed to create band" })),
            ),
          );

        const id = created.id;
        if (!id) return yield* new BandError({ message: "Failed to create band" });
        return yield* db
          .selectFrom("app_public.bands")
          .select(bandColumns)
          .where("app_public.bands.id", "=", id)
          .pipe(Effect.head);
      },
      Effect.catch((e) => {
        if (e._tag === "BandError") return Effect.fail(e);
        const info = pgError(e);
        if (info?.constraint === "bands_slug_key")
          return Effect.fail(new BandError({ message: "A band with that slug already exists" }));
        return Effect.logError("createBand failed", e).pipe(
          Effect.andThen(Effect.fail(new BandError({ message: "Could not create band" }))),
        );
      }),
    );

    const inviteToBand = Effect.fn("Bands.inviteToBand")(
      function* (args: { bandId: string; username?: string; email?: string }) {
        const db = yield* RequestDatabase;
        yield* db.selectNoFrom([
          sql`app_public.invite_to_band(
            band_id => ${args.bandId}::uuid,
            username => ${args.username ?? null}::citext,
            email => ${args.email ?? null}::citext
          )`.as("_"),
        ]);
      },
      Effect.catch((e) => {
        const code = pgError(e)?.code;
        if (code === "LOGIN")
          return Effect.fail(new BandError({ message: "You must be logged in" }));
        if (code === "DNIED")
          return Effect.fail(new BandError({ message: "You must be the band owner to invite" }));
        if (code === "ISMBR")
          return Effect.fail(new BandError({ message: "That person is already a member" }));
        if (code === "NTFND")
          return Effect.fail(new BandError({ message: "Could not find that person" }));
        // band_invitations is unique on (band, user) and on (band, email).
        if (code === "23505")
          return Effect.fail(
            new BandError({ message: "That person already has an invitation to this band" }),
          );
        if (code === "VRFY2")
          return Effect.fail(
            new BandError({
              message: "That account has not verified its email yet, so it cannot be invited",
            }),
          );
        return Effect.logError("inviteToBand failed", e).pipe(
          Effect.andThen(Effect.fail(new BandError({ message: "Failed to send invite" }))),
        );
      }),
    );

    /** The invitations addressed to the current user. */
    const listInvitations = Effect.fn("Bands.listInvitations")(function* () {
      const db = yield* RequestDatabase;
      return yield* db
        .selectFrom(sql<{ id: string; band_id: string; band_name: string }>`app_public.my_band_invitations()`.as("i"))
        .selectAll();
    });

    const acceptInvitation = Effect.fn("Bands.acceptInvitation")(
      function* (invitationId: string, code: string | null) {
        const db = yield* RequestDatabase;
        const [row] = yield* db.selectNoFrom([
          sql<string>`app_public.accept_invitation_to_band(${invitationId}::uuid, ${code}::text)`.as("band_id"),
        ]);
        return { bandId: row.band_id };
      },
      Effect.catch((e) => {
        const code = pgError(e)?.code;
        if (code === "NTFND") return Effect.fail(new BandError({ message: "That invitation no longer exists" }));
        if (code === "DNIED") return Effect.fail(new BandError({ message: "That invitation is not for you" }));
        if (code === "INCOD") return Effect.fail(new BandError({ message: "That code does not match this invitation" }));
        return Effect.logError("acceptInvitation failed", e).pipe(
          Effect.andThen(Effect.fail(new BandError({ message: "Could not accept the invitation" }))),
        );
      }),
    );

    const declineInvitation = Effect.fn("Bands.declineInvitation")(
      function* (invitationId: string) {
        const db = yield* RequestDatabase;
        yield* db.selectNoFrom([sql`app_public.decline_invitation_to_band(${invitationId}::uuid)`.as("_")]);
      },
      Effect.catch((e) =>
        Effect.logError("Could not decline the invitation", e).pipe(
          Effect.andThen(Effect.fail(new BandError({ message: "Could not decline the invitation" }))),
        ),
      ),
    );

    /** Pending invitations for a band. Only the owner may call this. */
    const listPendingInvitations = Effect.fn("Bands.listPendingInvitations")(
      function* (bandId: string) {
        const db = yield* RequestDatabase;
        return yield* db
          .selectFrom(
            sql<{ id: string; username: string | null; email: string | null }>`app_public.band_pending_invitations(${bandId}::uuid)`.as(
              "i",
            ),
          )
          .selectAll();
      },
      Effect.catch((e) => {
        const code = pgError(e)?.code;
        if (code === "DNIED")
          return Effect.fail(new BandError({ message: "You must be the band owner to see invitations" }));
        return Effect.logError("listPendingInvitations failed", e).pipe(
          Effect.andThen(Effect.fail(new BandError({ message: "Could not load invitations" }))),
        );
      }),
    );

    /** Delete a pending invitation. Only the band's owner may cancel it. */
    const cancelInvitation = Effect.fn("Bands.cancelInvitation")(
      function* (args: { bandId: string; invitationId: string }) {
        const db = yield* RequestDatabase;
        yield* db.selectNoFrom([
          sql`app_public.cancel_invitation(${args.bandId}::uuid, ${args.invitationId}::uuid)`.as("_"),
        ]);
      },
      Effect.catch((e) => {
        const code = pgError(e)?.code;
        if (code === "NTFND") return Effect.fail(new BandError({ message: "That invitation no longer exists" }));
        if (code === "DNIED")
          return Effect.fail(new BandError({ message: "You must be the band owner to cancel an invitation" }));
        return Effect.logError("cancelInvitation failed", e).pipe(
          Effect.andThen(Effect.fail(new BandError({ message: "Could not cancel the invitation" }))),
        );
      }),
    );

    const deleteBand = Effect.fn("Bands.deleteBand")(
      function* (bandId: string) {
        const db = yield* RequestDatabase;
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
      Effect.catchIf(
        (e): e is Exclude<typeof e, BandError> => e._tag !== "BandError",
        (e) => Effect.logError("Could not delete the band", e).pipe(Effect.andThen(Effect.fail(new BandError({ message: "Could not delete the band" })))),
      ),
    );

    const updateBand = Effect.fn("Bands.updateBand")(
      function* ({ bandId, page_options, ...fields }: { bandId: string } & BandUpdate) {
        const db = yield* RequestDatabase;
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
          return yield* new BandError({ message: "Only the owner can update the band" });
        }

        // Kysely drops undefined fields from `set`, so the patch holds only what
        // the owner sent. With nothing to change, read the row instead.
        const patch = {
          ...fields,
          page_options: page_options === undefined ? undefined : JSON.stringify(page_options),
        };
        const changed = Object.values(patch).some((v) => v !== undefined);
        const row = changed
          ? db
              .updateTable("app_public.bands")
              .set(patch)
              .where("app_public.bands.id", "=", bandId)
              .returning(bandColumns)
          : db.selectFrom("app_public.bands").select(bandColumns).where("app_public.bands.id", "=", bandId);
        return yield* row.pipe(
          Effect.head,
          Effect.catchTag("NoSuchElementError", () =>
            Effect.fail(new BandError({ message: "Band not found" })),
          ),
        );
      },
      Effect.catchIf(
        (e): e is Exclude<typeof e, BandError> => e._tag !== "BandError",
        (e) => Effect.logError("Could not update the band", e).pipe(Effect.andThen(Effect.fail(new BandError({ message: "Could not update the band" })))),
      ),
    );

    /**
     * A band's public page, read as the visitor (signed out or not). The bands
     * table is member-scoped, so every read goes through a security definer
     * function that returns only public fields. `public_band` returns no row while
     * the page is off, and each list function returns no rows while the owner keeps
     * that list hidden.
     */
    const getPublicBandProfile = Effect.fn("Bands.getPublicBandProfile")(function* (slug: string) {
      const db = yield* RequestDatabase;
      const band = yield* db
        .selectFrom(
          sql<{
            slug: string;
            name: string;
            description: string | null;
            page_theme: string | null;
            page_options: Record<string, string>;
          }>`app_public.public_band(${slug}::citext)`.as("b"),
        )
        .selectAll()
        .pipe(
          Effect.head,
          Effect.catchTag("NoSuchElementError", () => Effect.fail(new PublicBandMissing({ slug }))),
        );

      const members = yield* db
        .selectFrom(
          sql<{
            username: string;
            name: string | null;
            avatar_url: string | null;
            is_owner: boolean;
          }>`app_public.public_band_members(${slug}::citext)`.as("m"),
        )
        .selectAll();

      // `date` as text: the driver would otherwise build a local-midnight Date,
      // which shifts the day in any zone west of UTC.
      const gigs = yield* db
        .selectFrom(sql<{ venue: string | null; gig_date: string }>`app_public.public_band_gig_dates(${slug}::citext)`.as("g"))
        .select(["g.venue", sql<string>`g.gig_date::text`.as("gig_date")]);

      const songs = yield* db
        .selectFrom(sql<{ title: string; artist: string | null }>`app_public.public_band_songs(${slug}::citext)`.as("s"))
        .selectAll();

      return {
        slug: band.slug,
        name: band.name,
        description: band.description,
        page_theme: band.page_theme,
        page_options: band.page_options,
        members,
        gigs,
        songs,
      };
    });

    const removeMember = Effect.fn("Bands.removeMember")(
      function* (args: { bandId: string; userId: string }) {
        const db = yield* RequestDatabase;
        const [me] = yield* db.selectNoFrom([
          sql<string>`app_public.current_user_id()`.as("user_id"),
        ]);

        if (me.user_id === args.userId) {
          return yield* new BandError({ message: "Use Leave to remove yourself" });
        }

        yield* db.selectNoFrom([
          sql`app_public.remove_from_band(
            ${args.bandId}::uuid,
            ${args.userId}::uuid
          )`.as("_"),
        ]);
      },
      Effect.catchIf(
        (e): e is Exclude<typeof e, BandError> => e._tag !== "BandError",
        (e) =>
          pgError(e)?.code === "DNIED"
            ? Effect.fail(new BandError({ message: "You cannot remove that member" }))
            : Effect.logError("Could not remove member", e).pipe(
                Effect.andThen(Effect.fail(new BandError({ message: "Could not remove member" }))),
              ),
      ),
    );

    /**
     * Leave a band. An owner with other members must name `transferTo` so ownership
     * moves first; the sole owner must delete the band instead.
     */
    const leaveBand = Effect.fn("Bands.leaveBand")(
      function* (args: { bandId: string; transferTo: string | undefined }) {
        const db = yield* RequestDatabase;
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
      Effect.catchIf(
        (e): e is Exclude<typeof e, BandError> => e._tag !== "BandError",
        (e) => Effect.logError("Could not leave the band", e).pipe(Effect.andThen(Effect.fail(new BandError({ message: "Could not leave the band" })))),
      ),
    );

    /**
     * Whether the request's user belongs to `bandId`. The policies already
     * refuse a non-member; this lets a caller answer 403 instead of an empty
     * result. It runs in the caller's transaction, so both agree on the user.
     */
    const isMember = Effect.fnUntraced(function* (bandId: string) {
      const db = yield* RequestDatabase;
      // `current_user_member_band_ids()` is a `setof uuid`; `select * from fn() as ids`
      // names its one column after the alias.
      const rows = yield* db
        .selectFrom(sql<{ ids: string }>`app_public.current_user_member_band_ids()`.as("ids"))
        .selectAll()
        .pipe(Effect.orDie);
      return rows.some((row) => row.ids === bandId);
    });

    return {
      isMember,
      getUserBands,
      getBandMembers,
      createBand,
      inviteToBand,
      listInvitations,
      acceptInvitation,
      declineInvitation,
      listPendingInvitations,
      cancelInvitation,
      deleteBand,
      updateBand,
      getPublicBandProfile,
      transferOwnership,
      removeMember,
      leaveBand,
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
