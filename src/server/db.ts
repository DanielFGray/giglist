import { Config, Context, Effect, Layer } from "effect"
import { PgClient } from "@effect/sql-pg"
import * as PgKysely from "@effect/sql-kysely/Pg"
import { sql } from "kysely"
import type { DB } from "../../generated/DB.js"

export type KyselyDB = PgKysely.EffectKysely<DB>

/**
 * Run a query with RLS context set for the given session.
 * Sets `my.session_id` so PG functions like
 * `current_session_id()` and `current_user_id()` work.
 */
export const withSession = <A, E>(
  db: KyselyDB,
  sessionId: string | undefined,
  effect: Effect.Effect<A, E>,
) =>
  db.withTransaction(
    Effect.gen(function* () {
      yield* db.selectNoFrom([
        sql<string>`set_config('my.session_id', ${sessionId ?? ""}, true)`.as("_"),
      ])
      return yield* effect
    }),
  )

/** Kysely query builder wired through Effect SQL — no promise conversion needed */
export class Db extends Context.Tag("Db")<Db, KyselyDB>() {
  static Conn = Layer.unwrapEffect(
    Config.redacted("DATABASE_URL").pipe(
      Effect.map((url) =>
        PgClient.layer({ url }),
      ),
    ),
  )

  static Kysely = Layer.effect(this, PgKysely.make<DB>())

  static Live = this.Kysely.pipe(Layer.provide(this.Conn))
}
