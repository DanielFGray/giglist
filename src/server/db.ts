import { Config, Context, Effect, Layer, Option } from "effect"
import { PgClient } from "@effect/sql-pg"
import * as PgKysely from "./effect-kysely"
import { sql } from "kysely"
import type { DB } from "../../generated/DB.js"
import { CurrentSession } from "../api/session"

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
export class Db extends Context.Service<Db, KyselyDB>()("Db") {
  static Conn = Layer.unwrap(
    Config.Redacted("DATABASE_URL").pipe(
      Effect.map((url) =>
        PgClient.layer({ url }),
      ),
    ),
  )

  static Kysely = Layer.effect(this, PgKysely.makePg<DB>())

  static Live = this.Kysely.pipe(Layer.provide(this.Conn))
}

/**
 * Connection the app makes on a user's behalf. The role has NO INHERITANCE, so
 * it holds none of the grants until a request says `SET ROLE` to the visitor
 * role — see `withAuthContext`.
 */
export class AuthDb extends Context.Service<AuthDb, KyselyDB>()("AuthDb") {
  static Conn = Layer.unwrap(
    Config.Redacted("AUTH_DATABASE_URL").pipe(
      Effect.map((url) =>
        PgClient.layer({ url }),
      ),
    ),
  )

  static Kysely = Layer.effect(this, PgKysely.makePg<DB>())

  static Live = this.Kysely.pipe(Layer.provide(this.Conn))
}

/** The visitor role that the authenticator must set. */
export class AuthVisitor extends Context.Service<AuthVisitor, string>()("AuthVisitor") {
  static Live = Layer.effect(
    this,
    Config.String("DATABASE_VISITOR"),
  )
}

/**
 * The connection a visitor-scoped service queries. Only `withAuthContext`
 * provides it: the authenticator transaction, switched to the visitor role, for
 * one request. A service method yields it per call, so the requirement is part
 * of every visitor-scoped method by design.
 *
 * @effect-leakable-service
 */
export class RequestDatabase extends Context.Service<RequestDatabase, KyselyDB>()("RequestDatabase") {}

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
 * Database failures become defects rather than errors. A caller cannot do
 * anything with a SqlError, and letting it into an endpoint's error channel
 * would turn it into a 400 the client is expected to read.
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
        yield* db.selectNoFrom([
          // Transaction-local, so the pooled connection returns to the
          // authenticator when the request ends. The role is a trusted name
          // from the environment, so it is inlined as a literal rather than
          // bound. The session id is user input and stays a bound parameter.
          sql<string>`set_config('role', ${sql.lit(visitor)}, true)`.as("_"),
          sql<string>`set_config('my.session_id', ${sessionId}, true)`.as("_"),
        ])

        return yield* effect.pipe(Effect.provideService(RequestDatabase, db))
      }),
    ).pipe(Effect.catchTag("SqlError", Effect.die))
  })
