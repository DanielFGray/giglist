import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Bands } from "../services/band"
import { withAuthContext } from "../db"
import { asSignedIn, ifSignedIn } from "./scope"
import { BandError } from "../../api/bands"
import { GigListApi } from "../../api/contracts"

const ok = { ok: true as const }

/** Answers a service failure with its message, as the 4xx the browser shows. */
const asBandError = Effect.mapError((e: { readonly message: string }) => new BandError({ message: e.message }))

/**
 * A band mutation needs a user. Without one the visitor role resolves no user,
 * so `create_band` would try to insert an owner membership with a null user_id
 * and the request would die as a 500 instead of answering a 4xx the browser can
 * show.
 */
const asMember = asSignedIn(() => new BandError({ message: "You must be signed in" }))

/**
 * The lists answer a signed-out request with nothing, not an error: the visitor
 * role's policies cannot name a user without a session id.
 */
const asMemberOrNone = <A, E, R>(effect: Effect.Effect<ReadonlyArray<A>, E, R>) =>
  effect.pipe(withAuthContext, ifSignedIn(Effect.succeed([])))

export const BandsApiGroupLive = HttpApiBuilder.group(GigListApi, "myBands", (handlers) =>
  handlers
    .handle("listBands", () =>
      Bands.use((bands) => bands.getUserBands()).pipe(Effect.map((rows) => rows.map(toBandInfo)), asMemberOrNone),
    )
    .handle("listInvitations", () =>
      Bands.use((bands) => bands.listInvitations()).pipe(
        Effect.map((rows) => rows.map((r) => ({ id: r.id, band_id: r.band_id, band_name: r.band_name }))),
        Effect.orDie,
        asMemberOrNone,
      ),
    )
    .handle("acceptInvitation", ({ params: { invitationId }, payload: { code } }) =>
      Bands.use((bands) => bands.acceptInvitation(invitationId, code)).pipe(asBandError, asMember),
    )
    .handle("declineInvitation", ({ params: { invitationId } }) =>
      Bands.use((bands) => bands.declineInvitation(invitationId)).pipe(asBandError, asMember),
    )
    .handle("getBandMembers", ({ params: { bandId } }) =>
      Bands.use((bands) => bands.getBandMembers(bandId)).pipe(
        Effect.map((rows) =>
          rows.map((m) => ({
            id: m.id,
            user_id: m.user_id,
            is_owner: m.is_owner,
            created_at: m.created_at,
            username: m.username,
            name: m.name ?? null,
            avatar_url: m.avatar_url ?? null,
          })),
        ),
        asMember,
      ),
    )
    .handle("createBand", ({ payload }) =>
      Bands.use((bands) => bands.createBand(payload)).pipe(Effect.map(toBandInfo), asBandError, asMember),
    )
    .handle("deleteBand", ({ params: { bandId } }) =>
      Bands.use((bands) => bands.deleteBand(bandId)).pipe(asBandError, Effect.as(ok), asMember),
    )
    .handle("updateBand", ({ params: { bandId }, payload }) =>
      Bands.use((bands) => bands.updateBand({ bandId, ...payload })).pipe(
        Effect.map(toBandInfo),
        asBandError,
        asMember,
      ),
    )
    .handle("leaveBand", ({ params: { bandId }, payload }) =>
      Bands.use((bands) => bands.leaveBand({ bandId, transferTo: payload.transfer_to })).pipe(
        asBandError,
        Effect.as(ok),
        asMember,
      ),
    )
    .handle("transferOwnership", ({ params: { bandId }, payload }) =>
      Bands.use((bands) => bands.transferOwnership({ bandId, userId: payload.user_id })).pipe(
        asBandError,
        Effect.as(ok),
        asMember,
      ),
    )
    .handle("removeMember", ({ params: { bandId, userId } }) =>
      Bands.use((bands) => bands.removeMember({ bandId, userId })).pipe(asBandError, Effect.as(ok), asMember),
    )
    .handle("inviteToBand", ({ params: { bandId }, payload }) =>
      Bands.use((bands) => bands.inviteToBand({ bandId, username: payload.username, email: payload.email })).pipe(
        asBandError,
        asMember,
      ),
    )
    .handle("listPendingInvitations", ({ params: { bandId } }) =>
      Bands.use((bands) => bands.listPendingInvitations(bandId)).pipe(
        Effect.map((rows) => rows.map((r) => ({ id: r.id, username: r.username ?? null, email: r.email ?? null }))),
        asBandError,
        asMember,
      ),
    )
    .handle("cancelInvitation", ({ params: { bandId, invitationId } }) =>
      Bands.use((bands) => bands.cancelInvitation({ bandId, invitationId })).pipe(asBandError, Effect.as(ok), asMember),
    ),
)

/** A band row as `BandInfo`, with nullable text as undefined-free nulls. */
const toBandInfo = <B extends { description: string | null }>(band: B) => ({
  ...band,
  description: band.description ?? null,
})
