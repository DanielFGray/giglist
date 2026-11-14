import { Cause, Config, Context, Effect, Layer, Option } from "effect"
import { PgClient } from "@effect/sql-pg"
import * as PgKysely from "./effectKysely"
import { sql } from "kysely"
import type { DB } from "../../generated/DB.js"
import { CurrentSession } from "../api/session"
import { ServiceUnavailable } from "../api/errors"
import type { DatabaseError } from "./databaseError"

export type KyselyDB = PgKysely.EffectKysely<DB>

/**
 * Connection as the table owner.
 *
 * PostgreSQL does not apply the app_public row-level security policies to the
 * table owner, so this pool is for the app_private schema (sessions, user
 * creation) and for tooling that must ignore policies. No request that carries
 * a user identity may run on it: RLS is the only thing keeping one band's songs
 * out of another band's result set.
 */
export class Db extends Context.Service<Db, KyselyDB>()("giglist/db", {
  make: PgKysely.makePg<DB>(),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })),
  )
}

/**
 * Connection the app makes on a user's behalf. The role has NO INHERITANCE, so
 * it holds none of the grants until a request says `SET ROLE` to the visitor
 * role — see `withAuthContext`.
 */
export class AuthDb extends Context.Service<AuthDb, KyselyDB>()("giglist/db/AuthDb", {
  make: PgKysely.makePg<DB>(),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(PgClient.layerConfig({ url: Config.Redacted("AUTH_DATABASE_URL") })),
  )
}

/** The visitor role that the authenticator must set. */
export class AuthVisitor extends Context.Service<AuthVisitor, string>()("giglist/db/AuthVisitor", {
  make: Config.String("DATABASE_VISITOR"),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

/**
 * The connection a visitor-scoped service queries. Only `withAuthContext`
 * provides it: the authenticator transaction, switched to the visitor role, for
 * one request. A service method yields it per call, so the requirement is part
 * of every visitor-scoped method by design.
 *
 * @perRequest: withAuthContext provides it for each request.
 * @effect-leakable-service
 */
export class RequestDatabase extends Context.Service<RequestDatabase, KyselyDB>()("giglist/db/RequestDatabase") {}

/**
 * Make `effect` run as the request's user.
 *
 * It runs on the authenticator connection and sets two settings inside a
 * transaction: the role becomes the visitor role (transaction-scoped, so the
 * connection returns to the authenticator afterwards), and `my.session_id` is
 * set so `current_user_id()` can resolve the user for the RLS policies.
 *
 * The transaction is the mechanism, not an implementation detail: `SET LOCAL`
 * is undone at commit, so nothing leaks into the next request that borrows the
 * connection.
 *
 * A failed database call stays a DatabaseError in the error channel. The
 * endpoint answers it through toHttpError (dbErrors.ts), except a refused
 * switch to the visitor role, which is a fault in the server's settings and
 * answers 503 (refusedRoleSwitch).
 */
export const withAuthContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const db = yield* AuthDb
    const visitor = yield* AuthVisitor
    // A request outside SessionMiddleware (the public pages) runs as an
    // anonymous visitor, as does one whose cookie names no live session.
    const sessionId = Option.match(yield* Effect.serviceOption(CurrentSession), {
      onNone: () => "",
      onSome: (session) => session.sessionId,
    })

    return yield* db.withTransaction(
      Effect.gen(function* () {
        yield* db
          .selectNoFrom([
            // Transaction-local, so the pooled connection returns to the
            // authenticator when the request ends. The role is a trusted name
            // from the environment, so it is inlined as a literal rather than
            // bound. The session id is user input and stays a bound parameter.
            sql<string>`set_config('role', ${sql.lit(visitor)}, true)`.as("_"),
            sql<string>`set_config('my.session_id', ${sessionId}, true)`.as("_"),
          ])
          .pipe(Effect.catchTag("DatabaseError", refusedRoleSwitch(visitor)))

        return yield* effect.pipe(Effect.provideService(RequestDatabase, db))
      }),
    )
  })

/**
 * A refused switch to the visitor role is a fault in the server's settings:
 * `DATABASE_VISITOR` names no role (22023), or a role the authenticator is not
 * a member of (42501). It answers 503 misconfigured and logs at Error with the
 * role name. Any other failure passes on to toHttpError, whose table would read
 * 42501 as a row that row-level security refused (403).
 */
const refusedRoleSwitch = (role: string) =>
  Effect.fnUntraced(function* (error: DatabaseError) {
    const refused = Option.exists(error.report, ({ code }) => roleSwitchRefusals.has(code))
    if (!refused) return yield* error
    yield* Effect.logError(`Could not switch to the visitor role '${role}'`, Cause.fail(error))
    return yield* new ServiceUnavailable({
      message: "The service is not available right now.",
      reason: "misconfigured",
    })
  })

const roleSwitchRefusals = new Set(["42501", "22023"])
