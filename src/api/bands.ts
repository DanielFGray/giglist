import { Schema as S } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Email } from "./auth"
import { RateLimitMiddleware } from "./rate-limit"
import { SessionMiddleware } from "./session"

// --- Bands schemas ---

/**
 * How a band's public page looks (docs/adr/0006): `page_theme` is an HTML
 * document with theme tags, or null for the built-in Classic theme, and
 * `page_options` holds the band's values for the options the theme declares,
 * keyed like `color:Accent`.
 */
export const PageTheme = S.Struct({
  page_theme: S.NullOr(S.String.pipe(S.check(S.isMaxLength(200_000)))),
  page_options: S.Record(
    S.String.pipe(S.check(S.isPattern(/^(color|image|text|if):[A-Za-z][A-Za-z0-9 ]*$/))),
    S.String.pipe(S.check(S.isMaxLength(2000))),
  ),
})

export const BandInfo = S.Struct({
  id: S.String.check(S.isUUID()),
  slug: S.String,
  name: S.String,
  description: S.NullOr(S.String),
  is_public: S.Boolean,
  show_members_publicly: S.Boolean,
  show_gig_dates_publicly: S.Boolean,
  show_songs_publicly: S.Boolean,
  ...PageTheme.fields,
  created_at: S.Date,
})

export const BandMember = S.Struct({
  id: S.String.check(S.isUUID()),
  user_id: S.String.check(S.isUUID()),
  is_owner: S.Boolean,
  created_at: S.Date,
  username: S.String,
  name: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
})

/** An invitation to join a band, addressed to the signed-in user. */
export const BandInvitation = S.Struct({
  id: S.String.check(S.isUUID()),
  band_id: S.String.check(S.isUUID()),
  band_name: S.String,
})

/**
 * A pending invitation the band owner can see. User invitations carry a
 * username; address invitations carry an email. The secret code is never
 * included.
 */
export const PendingInvitation = S.Struct({
  id: S.String.check(S.isUUID()),
  username: S.NullOr(S.String),
  email: S.NullOr(S.String),
})

/** `code` is the secret from an emailed invitation's link; a user's own invitation has none. */
export const AcceptInvitationPayload = S.Struct({
  code: S.NullOr(S.String),
})

export const AcceptInvitationSuccess = S.Struct({ bandId: S.String })

export const CreateBandPayload = S.Struct({
  slug: S.String,
  name: S.String,
})

export const UpdateBandPayload = S.Struct({
  // Markdown (docs/adr/0010): room for prose plus the links and pasted embed code that become players.
  description: S.optional(S.NullOr(S.String.pipe(S.check(S.isMaxLength(10000))))),
  is_public: S.optional(S.Boolean),
  show_members_publicly: S.optional(S.Boolean),
  show_gig_dates_publicly: S.optional(S.Boolean),
  show_songs_publicly: S.optional(S.Boolean),
  page_theme: S.optional(PageTheme.fields.page_theme),
  page_options: S.optional(PageTheme.fields.page_options),
})

export const PublicBandMember = S.Struct({
  username: S.String,
  name: S.NullOr(S.String),
  avatar_url: S.NullOr(S.String),
  is_owner: S.Boolean,
})

export const PublicBandGig = S.Struct({
  venue: S.NullOr(S.String),
  /** `YYYY-MM-DD` */
  gig_date: S.String,
})

export const PublicBandSong = S.Struct({
  title: S.String,
  artist: S.NullOr(S.String),
})

/**
 * A band's public page. Each list is empty when the owner has not turned it on,
 * so the page shows a section exactly when its list has rows.
 */
export const PublicBandProfile = S.Struct({
  slug: S.String,
  name: S.String,
  description: S.NullOr(S.String),
  ...PageTheme.fields,
  members: S.Array(PublicBandMember),
  gigs: S.Array(PublicBandGig),
  songs: S.Array(PublicBandSong),
})

export const InvitePayload = S.Struct({
  username: S.optional(S.String),
  // An emailed invitation signs its reader up with this address, so it must be one sign-up accepts.
  email: S.optional(Email),
})

/**
 * Leave a band. Owners with other members must name a successor; the sole
 * owner deletes the band instead (`DELETE /:bandId`).
 */
export const LeaveBandPayload = S.Struct({
  transfer_to: S.optional(S.String.check(S.isUUID())),
})

export const TransferOwnershipPayload = S.Struct({
  user_id: S.String.check(S.isUUID()),
})

export const BandSuccess = S.Struct({ ok: S.Literals([true]) })

export class BandError extends S.TaggedError<BandError, { readonly brand: unique symbol }>()("BandError", { message: S.String }, { httpApiStatus: 400 }) {}

// --- Bands API group ---

export const BandsApiGroup = HttpApiGroup.make("myBands")
  .add(
    HttpApiEndpoint.get("listBands", "/", {
      success: S.Array(BandInfo),
    }),
  )
  .add(
    HttpApiEndpoint.get("getBandMembers", "/:bandId/members", {
      params: { bandId: S.String.check(S.isUUID()) },
      success: S.Array(BandMember),
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("createBand", "/", {
      payload: CreateBandPayload,
      success: BandInfo,
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteBand", "/:bandId", {
      params: { bandId: S.String.check(S.isUUID()) },
      success: BandSuccess,
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.put("updateBand", "/:bandId", {
      params: { bandId: S.String.check(S.isUUID()) },
      payload: UpdateBandPayload,
      success: BandInfo,
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("leaveBand", "/:bandId/leave", {
      params: { bandId: S.String.check(S.isUUID()) },
      payload: LeaveBandPayload,
      success: BandSuccess,
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("transferOwnership", "/:bandId/transfer", {
      params: { bandId: S.String.check(S.isUUID()) },
      payload: TransferOwnershipPayload,
      success: BandSuccess,
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("removeMember", "/:bandId/members/:userId", {
      params: {
        bandId: S.String.check(S.isUUID()),
        userId: S.String.check(S.isUUID()),
      },
      success: BandSuccess,
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.get("listInvitations", "/invitations", {
      success: S.Array(BandInvitation),
    }),
  )
  .add(
    HttpApiEndpoint.post("acceptInvitation", "/invitations/:invitationId/accept", {
      params: { invitationId: S.String.check(S.isUUID()) },
      payload: AcceptInvitationPayload,
      success: AcceptInvitationSuccess,
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("declineInvitation", "/invitations/:invitationId/decline", {
      params: { invitationId: S.String.check(S.isUUID()) },
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.post("inviteToBand", "/:bandId/invite", {
      params: { bandId: S.String.check(S.isUUID()) },
      payload: InvitePayload,
      error: BandError,
    }).middleware(RateLimitMiddleware),
  )
  .add(
    HttpApiEndpoint.get("listPendingInvitations", "/:bandId/invitations", {
      params: { bandId: S.String.check(S.isUUID()) },
      success: S.Array(PendingInvitation),
      error: BandError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("cancelInvitation", "/:bandId/invitations/:invitationId", {
      params: {
        bandId: S.String.check(S.isUUID()),
        invitationId: S.String.check(S.isUUID()),
      },
      success: BandSuccess,
      error: BandError,
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/my/bands")

export class PublicBandNotFound extends S.TaggedError<
  PublicBandNotFound,
  { readonly brand: unique symbol }
>()("PublicBandNotFound", { message: S.String, slug: S.String }, { httpApiStatus: 404 }) {}

export const PublicBandsApiGroup = HttpApiGroup.make("publicBands")
  .add(
    HttpApiEndpoint.get("getPublicBand", "/:slug", {
      params: { slug: S.String.pipe(S.check(S.isMinLength(1))) },
      success: PublicBandProfile,
      error: PublicBandNotFound,
    }),
  )
  .prefix("/api/public/bands")
