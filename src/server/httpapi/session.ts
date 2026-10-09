import { Effect, Layer, Redacted } from "effect"
import { sql } from "kysely"
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
          .selectFrom("app_private.sessions" as any)
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

/**
 * Set RLS context for the current session.
 * Must be called inside a transaction for the set_config to stick.
 */
export const setRlsContext = (sessionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.selectNoFrom([
      sql<string>`set_config('my.session_id', ${sessionId}, true)`.as("_"),
    ])
  })
