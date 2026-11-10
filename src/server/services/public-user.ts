import { Context, Effect, Layer, Schema } from "effect";
import { sql } from "kysely";
import { RequestDatabase } from "../db";

export class PublicUserMissing extends Schema.TaggedError<
  PublicUserMissing,
  { readonly brand: unique symbol }
>()("PublicUserMissing", { username: Schema.String }) {}

/**
 * A user's public profile, read as the visitor (signed out or not). The read
 * goes through the `public_user` security definer function, which returns a
 * row only while the user keeps their profile on, plus `public_user_bands`
 * for the bands they play in whose own pages are on (docs/adr/0011).
 */
export class PublicUsers extends Context.Service<PublicUsers>()("setlist/PublicUsers", {
  make: Effect.succeed({
    getPublicUserProfile: Effect.fn("PublicUsers.getProfile")(function* (username: string) {
      const db = yield* RequestDatabase;
      const user = yield* db
        .selectFrom(
          sql<{
            username: string;
            name: string | null;
            bio: string | null;
            avatar_url: string | null;
            page_theme: string | null;
            page_options: Record<string, string>;
          }>`app_public.public_user(${username}::citext)`.as("u"),
        )
        .selectAll()
        .pipe(
          Effect.head,
          Effect.catchTag("NoSuchElementError", () => Effect.fail(new PublicUserMissing({ username }))),
        );

      const bands = yield* db
        .selectFrom(sql<{ slug: string; name: string }>`app_public.public_user_bands(${username}::citext)`.as("b"))
        .selectAll();

      return { ...user, bands };
    }),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
