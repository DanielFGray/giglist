/**
 * Kysely + Effect integration.
 *
 * Effect v4 removed the `@effect/sql-kysely` package, so this is a port of it.
 * The technique is unchanged: Kysely runs with a dummy driver and its query
 * builders are given the Effect protocol, so `db.selectFrom(...)` is itself an
 * `Effect` that compiles the builder and runs the SQL through the active
 * `SqlClient`. A `Proxy` supplies the per-query execution effect, which is why
 * plugin tracking and `withTransaction` survive the builder chain.
 */
import { Effect, Effectable } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { SqlError, UnknownError } from "effect/sql/SqlError";
import {
  AlterTableColumnAlteringBuilder,
  CreateIndexBuilder,
  CreateSchemaBuilder,
  CreateTableBuilder,
  CreateTypeBuilder,
  CreateViewBuilder,
  DeleteQueryBuilder,
  DropIndexBuilder,
  DropSchemaBuilder,
  DropTableBuilder,
  DropTypeBuilder,
  DropViewBuilder,
  DummyDriver,
  InsertQueryBuilder,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  UpdateQueryBuilder,
  WheneableMergeQueryBuilder,
} from "kysely";
import type { Compilable, KyselyConfig, KyselyPlugin, QueryResult, Simplify } from "kysely";

/** Where the Proxy installs a builder's execution effect. */
const Commit = Symbol.for("setlist/effect-kysely/commit");

/**
 * The Effect protocol assigned to Kysely builder prototypes. Evaluating a
 * builder calls the commit effect the Proxy installs under `Commit`.
 *
 * The effect type is explicit so the protocol carries a typed error channel
 * rather than the `any` the options callback's dynamic `this` would infer.
 */
const BuilderProto = Effectable.Prototype<Effect.Effect<ReadonlyArray<unknown>, SqlError>>({
  label: "KyselyQuery",
  evaluate(this: any) {
    return this[Commit]();
  },
});

/**
 * The Effect protocol's own members (notably the string-keyed `evaluate`).
 * They must be returned from the Proxy untouched: the runtime calls them as
 * methods, so `this` stays the Proxy and `this[Commit]` resolves.
 */
const ProtoKeys = new Set<string | symbol>([
  ...Object.getOwnPropertyNames(BuilderProto),
  ...Object.getOwnPropertySymbols(BuilderProto),
]);

/** @internal */
export const patch = (prototype: object) => {
  if (Effect.TypeId in prototype) return
  // Copy the protocol's own descriptors key by key. `Object.assign` would work
  // equally well but its return value is the patched prototype, which is now
  // Effect-able, so the discarded result reads as a floating Effect.
  for (const key of Reflect.ownKeys(BuilderProto)) {
    const descriptor = Object.getOwnPropertyDescriptor(BuilderProto, key)
    if (descriptor !== undefined) {
      Object.defineProperty(prototype, key, descriptor)
    }
  }
};

// Builders that never pass through `selectFrom` still need the protocol, so
// their prototypes are patched once at module load.
patch(AlterTableColumnAlteringBuilder.prototype);
patch(CreateIndexBuilder.prototype);
patch(CreateSchemaBuilder.prototype);
patch(CreateTableBuilder.prototype);
patch(CreateTypeBuilder.prototype);
patch(CreateViewBuilder.prototype);
patch(DropIndexBuilder.prototype);
patch(DropSchemaBuilder.prototype);
patch(DropTableBuilder.prototype);
patch(DropTypeBuilder.prototype);
patch(DropViewBuilder.prototype);
patch(InsertQueryBuilder.prototype);
patch(UpdateQueryBuilder.prototype);
patch(DeleteQueryBuilder.prototype);
patch(WheneableMergeQueryBuilder.prototype);

function effectifyWith(
  obj: unknown,
  commit: (plugins: ReadonlyArray<KyselyPlugin>) => Effect.Effect<ReadonlyArray<unknown>, SqlError>,
  whitelist: Array<string>,
  plugins: ReadonlyArray<KyselyPlugin> = [],
): any {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }
  return new Proxy(obj, {
    get(target: any, prop: string | symbol, receiver) {
      // Proxy invariants require returning fixed properties unchanged.
      const desc = Object.getOwnPropertyDescriptor(target, prop);
      if (desc && !desc.configurable && !desc.writable) {
        return target[prop];
      }
      const prototype = Object.getPrototypeOf(target);
      if (Effect.TypeId in prototype && prop === Commit) {
        return commit.bind(target, plugins);
      }
      // Effect protocol members (`evaluate`, `pipe`, continuations) stay as-is.
      if (ProtoKeys.has(prop)) {
        return target[prop];
      }
      // The remaining symbol keys belong to the runtime; leave them untouched.
      if (typeof prop === "symbol") {
        return target[prop];
      }
      if (typeof target[prop] === "function") {
        if (whitelist.includes(prop)) {
          return target[prop].bind(target);
        }
        return (...args: Array<unknown>) => {
          // Callback helpers need the proxy to retain plugin tracking.
          if (prop === "$call" || (prop === "$if" && args[0])) {
            return target[prop].call(receiver, ...args);
          }
          return effectifyWith(
            target[prop].call(target, ...args),
            commit,
            whitelist,
            prop === "withPlugin"
              ? [...plugins, args[0] as KyselyPlugin]
              : prop === "withoutPlugins"
                ? []
                : plugins,
          );
        };
      }
      return effectifyWith(target[prop], commit, whitelist, plugins);
    },
  });
}

const makeSqlCommit = (client: SqlClient.SqlClient) => {
  return function (this: Compilable, plugins: ReadonlyArray<KyselyPlugin>) {
    const { parameters, queryId, sql } = this.compile();
    const execute = client.unsafe<Record<string, unknown>>(sql, parameters);
    if (plugins.length === 0) return execute;
    return Effect.flatMap(execute, (rows) =>
      Effect.map(
        Effect.reduce(
          plugins,
          () => ({ rows: Array.from(rows) }) as QueryResult<Record<string, unknown>>,
          (result, plugin) =>
            Effect.tryPromise({
              try: () => plugin.transformResult({ queryId, result }),
              catch: (cause) => new SqlError({ reason: new UnknownError({ cause }) }),
            }),
        ),
        (result) => result.rows,
      ),
    );
  };
};

/** @internal */
const effectifyWithSql = <T>(
  obj: T,
  client: SqlClient.SqlClient,
  whitelist: Array<string> = [],
  plugins: ReadonlyArray<KyselyPlugin> = [],
): T => effectifyWith(obj, makeSqlCommit(client), whitelist, plugins);

/**
 * Create a Kysely instance whose builders are Effects, executed through the
 * `SqlClient` in context. The dialect is a dummy driver, so Kysely only compiles.
 */
const makeWithSql = <DB>(config: KyselyConfig) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;

    const db = new Kysely<DB>(config) as unknown as EffectKysely<DB>;
    (db as any).withTransaction = client.withTransaction;

    // SelectQueryBuilder is not exported from "kysely", so its prototype is
    // patched from an instance.
    const selectPrototype = Object.getPrototypeOf(db.selectFrom("" as any));
    patch(selectPrototype);

    return effectifyWithSql(db, client, ["withTransaction", "compile"], config.plugins);
  });

/**
 * The PostgreSQL flavour: a dummy-driver dialect paired with the `SqlClient`
 * the application provides (the `@effect/sql-pg` client).
 */
export const makePg = <DB>(config?: Omit<KyselyConfig, "dialect">) =>
  makeWithSql<DB>({
    ...config,
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

/**
 * A Kysely instance whose query builders evaluate as Effects.
 */
export interface EffectKysely<DB> extends Omit<Kysely<DB>, "transaction"> {
  withTransaction: <R, E, A>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError, R>;
}

declare module "kysely" {
  interface AlterTableColumnAlteringBuilder extends Effect.Effect<void, SqlError> {}
  interface CreateIndexBuilder<C> extends Effect.Effect<void, SqlError> {}
  interface CreateSchemaBuilder extends Effect.Effect<void, SqlError> {}
  interface CreateTableBuilder<TB, C> extends Effect.Effect<void, SqlError> {}
  interface CreateTypeBuilder extends Effect.Effect<void, SqlError> {}
  interface CreateViewBuilder extends Effect.Effect<void, SqlError> {}
  interface DropIndexBuilder extends Effect.Effect<void, SqlError> {}
  interface DropSchemaBuilder extends Effect.Effect<void, SqlError> {}
  interface DropTableBuilder extends Effect.Effect<void, SqlError> {}
  interface DropTypeBuilder extends Effect.Effect<void, SqlError> {}
  interface DropViewBuilder extends Effect.Effect<void, SqlError> {}
  interface SelectQueryBuilder<DB, TB, O> extends Effect.Effect<Array<Simplify<O>>, SqlError> {}
  interface InsertQueryBuilder<DB, TB, O> extends Effect.Effect<Array<Simplify<O>>, SqlError> {}
  interface UpdateQueryBuilder<DB, UT, TB, O> extends Effect.Effect<Array<Simplify<O>>, SqlError> {}
  interface DeleteQueryBuilder<DB, TB, O> extends Effect.Effect<Array<Simplify<O>>, SqlError> {}
  interface WheneableMergeQueryBuilder<DB, TT, ST, O> extends Effect.Effect<
    Array<Simplify<O>>,
    SqlError
  > {}
}
