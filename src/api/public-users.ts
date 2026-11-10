import { Schema as S } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { PageTheme } from "./bands"

// --- Public user profiles ---

/** A band with a public page that a user belongs to, linked from their profile. */
export const PublicUserBand = S.Struct({
  slug: S.String,
  name: S.String,
})

/**
 * A user's public profile (docs/adr/0011). Present only while the user keeps
 * `is_public` on; `bands` holds only bands whose own page is also on.
 */
export const PublicUserProfile = S.Struct({
  username: S.String,
  name: S.NullOr(S.String),
  bio: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
  ...PageTheme.fields,
  bands: S.Array(PublicUserBand),
})

export class PublicUserNotFound extends S.TaggedError<
  PublicUserNotFound,
  { readonly brand: unique symbol }
>()("PublicUserNotFound", { username: S.String }) {}

export const PublicUsersApiGroup = HttpApiGroup.make("publicUsers")
  .add(
    HttpApiEndpoint.get("getPublicUser", "/:username", {
      params: { username: S.String.pipe(S.check(S.isMinLength(1))) },
      success: PublicUserProfile,
      error: PublicUserNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .prefix("/api/public/users")
