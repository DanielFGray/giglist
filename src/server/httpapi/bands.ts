import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import * as BandService from "../services/band";
import { withAuthContext } from "../db";
import { SetListApi, BandError, CurrentSession } from "../../api/contracts";

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

export const bandsHandlers = HttpApiBuilder.group(SetListApi, "myBands", (handlers) =>
  handlers
    .handle(
      "listBands",
      Effect.fnUntraced(function* () {
        const session = yield* CurrentSession;
        // No session means no bands, not every band: the visitor role's
        // policies cannot name a user without a session id.
        if (!session.sessionId || !session.userId) return [];

        return yield* BandService.getUserBands().pipe(
          Effect.map((rows) =>
            rows.map((b) => ({
              id: b.id,
              slug: b.slug,
              name: b.name,
              description: b.description ?? null,
              created_at: String(b.created_at),
            })),
          ),
          withAuthContext(session.sessionId),
        );
      }),
    )
    .handle(
      "getBandMembers",
      Effect.fnUntraced(function* ({ params: { bandId } }) {
        const session = yield* requireSession();
        return yield* BandService.getBandMembers(bandId).pipe(
          Effect.map((rows) =>
            rows.map((m) => ({
              id: m.id,
              user_id: m.user_id,
              is_owner: m.is_owner,
              created_at: String(m.created_at),
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
        return yield* BandService.createBand(payload).pipe(
          Effect.map((band) => ({
            id: band.id,
            slug: band.slug,
            name: band.name,
            description: null,
            created_at: new Date().toISOString(),
          })),
          withAuthContext(session.sessionId),
          Effect.mapError((e) => new BandError({ message: e.message })),
        );
      }),
    )
    .handle(
      "deleteBand",
      Effect.fnUntraced(function* ({ params: { bandId } }) {
        const session = yield* requireSession();
        return yield* BandService.deleteBand(bandId).pipe(
          withAuthContext(session.sessionId),
        );
      }),
    )
    .handle(
      "inviteToBand",
      Effect.fnUntraced(function* ({ params: { bandId }, payload }) {
        const session = yield* requireSession();
        return yield* BandService.inviteToBand({
          bandId,
          username: payload.username,
          email: payload.email,
        }).pipe(
          withAuthContext(session.sessionId),
          Effect.mapError((e) => new BandError({ message: e.message })),
        );
      }),
    ),
);
