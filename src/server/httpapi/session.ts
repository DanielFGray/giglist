import { Effect, Layer, Redacted } from "effect"
import { Db } from "../db"
import {
  CurrentSession,
  SessionMiddleware,
  type SessionData,
} from "../../api/contracts"

const noSession: SessionData = { sessionId: "", userId: null }

export const SessionMiddlewareLive = Layer.effect(
  SessionMiddleware,
  Effect.gen(function* () {
    const db = yield* Db

    // v4 middleware runs as a wrapper: it receives the inner handler effect and
    // the decoded credential, and must provide the session it declares.
    return {
      session: (effect, { credential }) => {
        const token = Redacted.value(credential)
        if (!token) {
          return Effect.provideService(effect, CurrentSession, noSession)
        }

        return db
          .selectFrom("app_private.sessions")
          .select(["uuid", "user_id"])
          .where("uuid", "=", token)
          .pipe(
            Effect.head,
            Effect.map((row) => ({
              sessionId: row.uuid,
              userId: row.user_id,
            })),
            Effect.orElseSucceed(() => noSession),
            Effect.flatMap((session) =>
              Effect.provideService(effect, CurrentSession, session),
            ),
          )
      },
    }
  }),
)
