import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Bands } from "../services/band";
import { withAuthContext } from "../db";
import { GigListApi, BandError, CurrentSession } from "../../api/contracts";

/**
 * A band mutation needs a user. Without one the visitor role resolves no user,
 * so `create_band` would try to insert an owner membership with a null user_id
 * and the request would die as a 500 instead of answering a 4xx the browser can
 * show. `listBands` is the exception: no session means no bands, not an error.
 */
const requireSession = Effect.fnUntraced(function* () {
  const session = yield* CurrentSession;
  if (!session.sessionId || !session.userId) {
    return yield* new BandError({ message: "You must be signed in" });
  }
  return session;
});

/** A band row as `BandInfo`, with nullable text as undefined-free nulls. */
const toBandInfo = <B extends { description: string | null }>(band: B) => ({
  ...band,
  description: band.description ?? null,
});

export const bandsHandlers = HttpApiBuilder.group(GigListApi, "myBands", (handlers) =>
  Effect.gen(function* () {
    const bands = yield* Bands
    return handlers
      .handle(
        "listBands",
        Effect.fnUntraced(function* () {
          const session = yield* CurrentSession;
          // No session means no bands, not every band: the visitor role's
          // policies cannot name a user without a session id.
          if (!session.sessionId || !session.userId) return [];

          return yield* bands.getUserBands().pipe(
            Effect.map((rows) => rows.map(toBandInfo)),
            withAuthContext(session.sessionId),
          );
        }),
      )
      .handle(
        "listInvitations",
        Effect.fnUntraced(function* () {
          const session = yield* CurrentSession;
          if (!session.sessionId || !session.userId) return [];
          return yield* bands.listInvitations().pipe(
            Effect.map((rows) => rows.map((r) => ({ id: r.id, band_id: r.band_id, band_name: r.band_name }))),
            Effect.orDie,
            withAuthContext(session.sessionId),
          );
        }),
      )
      .handle(
        "acceptInvitation",
        Effect.fnUntraced(function* ({ params: { invitationId }, payload: { code } }) {
          const session = yield* requireSession();
          return yield* bands.acceptInvitation(invitationId, code).pipe(
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
        }),
      )
      .handle(
        "declineInvitation",
        Effect.fnUntraced(function* ({ params: { invitationId } }) {
          const session = yield* requireSession();
          return yield* bands.declineInvitation(invitationId).pipe(
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
        }),
      )
      .handle(
        "getBandMembers",
        Effect.fnUntraced(function* ({ params: { bandId } }) {
          const session = yield* requireSession();
          return yield* bands.getBandMembers(bandId).pipe(
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
            withAuthContext(session.sessionId),
          );
        }),
      )
      .handle(
        "createBand",
        Effect.fnUntraced(function* ({ payload }) {
          const session = yield* requireSession();
          return yield* bands.createBand(payload).pipe(
            Effect.map(toBandInfo),
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
        }),
      )
      .handle(
        "deleteBand",
        Effect.fnUntraced(function* ({ params: { bandId } }) {
          const session = yield* requireSession();
          yield* bands.deleteBand(bandId).pipe(
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
          return { ok: true as const };
        }),
      )
      .handle(
        "updateBand",
        Effect.fnUntraced(function* ({ params: { bandId }, payload }) {
          const session = yield* requireSession();
          return yield* bands.updateBand({ bandId, ...payload }).pipe(
            Effect.map(toBandInfo),
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
        }),
      )
      .handle(
        "leaveBand",
        Effect.fnUntraced(function* ({ params: { bandId }, payload }) {
          const session = yield* requireSession();
          yield* bands.leaveBand({
            bandId,
            transferTo: payload.transfer_to,
          }).pipe(
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
          return { ok: true as const };
        }),
      )
      .handle(
        "transferOwnership",
        Effect.fnUntraced(function* ({ params: { bandId }, payload }) {
          const session = yield* requireSession();
          yield* bands.transferOwnership({
            bandId,
            userId: payload.user_id,
          }).pipe(
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
          return { ok: true as const };
        }),
      )
      .handle(
        "removeMember",
        Effect.fnUntraced(function* ({ params: { bandId, userId } }) {
          const session = yield* requireSession();
          yield* bands.removeMember({ bandId, userId }).pipe(
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
          return { ok: true as const };
        }),
      )
      .handle(
        "inviteToBand",
        Effect.fnUntraced(function* ({ params: { bandId }, payload }) {
          const session = yield* requireSession();
          return yield* bands.inviteToBand({
            bandId,
            username: payload.username,
            email: payload.email,
          }).pipe(
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
        }),
      )
      .handle(
        "listPendingInvitations",
        Effect.fnUntraced(function* ({ params: { bandId } }) {
          const session = yield* requireSession();
          return yield* bands.listPendingInvitations(bandId).pipe(
            Effect.map((rows) =>
              rows.map((r) => ({
                id: r.id,
                username: r.username ?? null,
                email: r.email ?? null,
              })),
            ),
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
        }),
      )
      .handle(
        "cancelInvitation",
        Effect.fnUntraced(function* ({ params: { bandId, invitationId } }) {
          const session = yield* requireSession();
          yield* bands.cancelInvitation({ bandId, invitationId }).pipe(
            withAuthContext(session.sessionId),
            Effect.mapError((e) => new BandError({ message: e.message })),
          );
          return { ok: true as const };
        }),
      )
  })
);
