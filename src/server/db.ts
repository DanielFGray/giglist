import { Config, Context, Effect, Layer } from "effect"
import { PgClient } from "@effect/sql-pg"
import * as PgKysely from "@effect/sql-kysely/Pg"
import type { DB } from "../../generated/DB.js"

export type KyselyDB = PgKysely.EffectKysely<DB>

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
