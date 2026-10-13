import { Effect, Layer, Redacted } from "effect"
import { Db } from "../db"
import {
  SessionMiddleware,
  type SessionData,
} from "../../api/contracts"

const noSession: SessionData = { sessionId: "", userId: null }

export const SessionMiddlewareLive = Layer.effect(
  SessionMiddleware,
  Effect.gen(function* () {
    const db = yield* Db

    return SessionMiddleware.of({
      session: (redactedToken: Redacted.Redacted<string>) => {
        const token = Redacted.value(redactedToken)
        if (!token) return Effect.succeed(noSession)

        return db
          .selectFrom("app_private.sessions")
          .select(["uuid", "user_id"])
          .where("uuid", "=", token)
          .pipe(
            Effect.head,
            Effect.map((row) => ({
              sessionId: row.uuid as string,
              userId: row.user_id as string,
            })),
            Effect.catchAll(() => Effect.succeed(noSession)),
          )
      },
    })
  }),
)
