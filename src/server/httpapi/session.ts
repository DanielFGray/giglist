import { Effect, Layer, Option, Redacted, Schema as S } from "effect"
import { sql } from "kysely"
import { nodeEnv } from "../config"
import { Db, queriesOn } from "../db"
import type { DB } from "../../../generated/DB.js"
import { CurrentSession, SessionMiddleware, type SessionData } from "../../api/session"

const noSession: SessionData = { sessionId: "", userId: null }

export const SessionMiddlewareLive = Layer.effect(
  SessionMiddleware,
  Effect.gen(function* () {
    const ownerDb = queriesOn<DB>(yield* Db)
    // v4 middleware runs as a wrapper: it receives the inner handler effect and
    // the decoded credential, and must provide the session it declares.
    return {
      session: (effect, { credential }) => {
        const token = Redacted.value(credential)
        if (!token) {
          return Effect.provideService(effect, CurrentSession, noSession)
        }

        // One statement: `candidate` is the session only while it is live,
        // and `refreshed` slides its window only when it is over an hour
        // old, so an accepted session writes at most once an hour. The
        // 30-day interval matches `maxAge` in sessionCookiePolicy below; keep
        // them equal.
        return ownerDb
          .maybe(S.Struct({ uuid: S.String, user_id: S.String }), (k) =>
            k
              .with("candidate", (qb) =>
                qb
                  .selectFrom("app_private.sessions")
                  .select(["uuid", "user_id", "last_active"])
                  .where("uuid", "=", token)
                  .where("last_active", ">", sql<Date>`now() - interval '30 days'`),
              )
              .with("refreshed", (qb) =>
                qb
                  .updateTable("app_private.sessions")
                  .set({ last_active: sql<Date>`now()` })
                  .where("uuid", "=", token)
                  .where("last_active", "<", sql<Date>`now() - interval '1 hour'`)
                  .where("last_active", ">", sql<Date>`now() - interval '30 days'`)
                  .returning("uuid"),
              )
              .selectFrom("candidate")
              .select(["uuid", "user_id"]),
          )
          .pipe(
            Effect.map(
              Option.match({
                onNone: () => noSession,
                onSome: (row): SessionData => ({ sessionId: row.uuid, userId: row.user_id }),
              }),
            ),
            Effect.orElseSucceed(() => noSession),
            Effect.flatMap((session) => Effect.provideService(effect, CurrentSession, session)),
          )
      },
    }
  }),
)

/**
 * The session cookie's browser attributes, stated once for every write and
 * clear. `maxAge` is the 30-day window the middleware above accepts.
 */
export const sessionCookiePolicy = Effect.gen(function* () {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: (yield* nodeEnv) === "production",
    path: "/",
    maxAge: "30 days",
  } as const
})
