import { Effect } from "effect"
import { HttpApiBuilder } from "@effect/platform"
import * as BandService from "../services/band"
import {
  SetListApi,
  BandError,
  CurrentSession,
} from "../../api/contracts"

export const bandsHandlers = HttpApiBuilder.group(SetListApi, "myBands", (handlers) =>
  handlers
    .handle("listBands", () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        if (!session.sessionId) return []
        const rows = yield* BandService.getUserBands(session.sessionId)
        return rows.map((b) => ({
          id: b.id,
          slug: b.slug,
          name: b.name,
          description: b.description ?? null,
          created_at: String(b.created_at),
        }))
      }).pipe(Effect.orDie),
    )
    .handle("getBandMembers", ({ path: { bandId } }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        const rows = yield* BandService.getBandMembers(session.sessionId, bandId)
        return rows.map((m) => ({
          id: m.id,
          user_id: m.user_id,
          is_owner: m.is_owner,
          created_at: String(m.created_at),
          username: m.username,
          name: m.name ?? null,
          avatar_url: m.avatar_url ?? null,
        }))
      }).pipe(Effect.orDie),
    )
    .handle("createBand", ({ payload }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        const band = yield* BandService.createBand(session.sessionId, payload)
        return {
          id: band.id,
          slug: band.slug,
          name: band.name,
          description: null,
          created_at: new Date().toISOString(),
        }
      }).pipe(
        Effect.catchAll((e) =>
          Effect.fail(new BandError({ message: "message" in e ? String(e.message) : "Failed to create band" })),
        ),
      ),
    )
    .handle("deleteBand", ({ path: { bandId } }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        yield* BandService.deleteBand(session.sessionId, bandId)
      }).pipe(
        Effect.catchAll((e) =>
          Effect.fail(new BandError({ message: String(e) })),
        ),
      ),
    )
    .handle("inviteToBand", ({ path: { bandId }, payload }) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        yield* BandService.inviteToBand(session.sessionId, {
          bandId,
          username: payload.username,
          email: payload.email,
        })
      }).pipe(
        Effect.catchAll((e) =>
          Effect.fail(new BandError({ message: "message" in e ? String(e.message) : "Failed to invite" })),
        ),
      ),
    ),
)
