import { Effect } from "effect";
import { HttpApiBuilder } from "@effect/platform";
import * as BandService from "../services/band";
import { withAuthContext } from "../db";
import { SetListApi, BandError, CurrentSession } from "../../api/contracts";

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
      Effect.fnUntraced(function* ({ path: { bandId } }) {
        const session = yield* CurrentSession;
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
        const session = yield* CurrentSession;
        return yield* BandService.createBand(payload).pipe(
          Effect.map((band) => ({
            id: band.id,
            slug: band.slug,
            name: band.name,
            description: null,
            created_at: new Date().toISOString(),
          })),
          withAuthContext(session.sessionId),
          Effect.catchAll((e) =>
            Effect.fail(
              new BandError({
                message: "message" in e ? String(e.message) : "Failed to create band",
              }),
            ),
          ),
        );
      }),
    )
    .handle(
      "deleteBand",
      Effect.fnUntraced(function* ({ path: { bandId } }) {
        const session = yield* CurrentSession;
        return yield* BandService.deleteBand(bandId).pipe(
          withAuthContext(session.sessionId),
          Effect.catchAll((e) => Effect.fail(new BandError({ message: String(e) }))),
        );
      }),
    )
    .handle(
      "inviteToBand",
      Effect.fnUntraced(function* ({ path: { bandId }, payload }) {
        const session = yield* CurrentSession;
        return yield* BandService.inviteToBand({
          bandId,
          username: payload.username,
          email: payload.email,
        }).pipe(
          withAuthContext(session.sessionId),
          Effect.catchAll((e) =>
            Effect.fail(
              new BandError({
                message: "message" in e ? String(e.message) : "Failed to invite",
              }),
            ),
          ),
        );
      }),
    ),
);
