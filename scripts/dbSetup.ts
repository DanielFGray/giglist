#!/usr/bin/env bun
import { NodeRuntime } from "@effect/platform-node";
import * as NodeTerminal from "@effect/platform-node/NodeTerminal";
import { PgClient } from "@effect/sql-pg";
import { Config, Duration, Effect, Option, Redacted, Schedule, Schema } from "effect";
import * as Terminal from "effect/Terminal";

class DbSetupCancelled extends Schema.TaggedError<
  DbSetupCancelled,
  { readonly brand: unique symbol }
>()("DbSetupCancelled", {
  message: Schema.String,
}) {}

const config = Effect.runSync(
  Config.all({
    rootDatabaseUrl: Config.String("ROOT_DATABASE_URL"),
    databaseName: Config.String("DATABASE_NAME"),
    owner: Config.String("DATABASE_OWNER"),
    ownerPassword: Config.String("DATABASE_OWNER_PASSWORD"),
    authenticator: Config.String("DATABASE_AUTHENTICATOR"),
    authenticatorPassword: Config.String("DATABASE_AUTHENTICATOR_PASSWORD"),
    visitor: Config.String("DATABASE_VISITOR"),
    shadowPassword: Config.String("SHADOW_DATABASE_PASSWORD"),
    nodeEnv: Config.String("NODE_ENV").pipe(Config.withDefault("development")),
    noConfirm: Config.option(Config.String("NOCONFIRM")),
  }),
);

const confirmReset = Effect.fnUntraced(function* (
  databaseName: string,
  roles: string[],
  noConfirm: Option.Option<string>,
) {
  if (Option.isSome(noConfirm)) return;

  const terminal = yield* Terminal.Terminal;
  yield* terminal.display(
    `This will drop ${databaseName}, ${databaseName}_shadow, ${databaseName}_test, and roles ${roles.join(", ")}. Continue? [y/N] `,
  );
  const answer = yield* terminal.readLine;
  if (!/^y(es)?$/i.test(answer.trim())) {
    return yield* new DbSetupCancelled({ message: "Database setup cancelled" });
  }
});

const createLoginRole = Effect.fnUntraced(function* (
  {role, password, attributes}: {
    role: string,
    password: string,
    attributes: string,
  }
) {
  const client = yield* PgClient.PgClient;
  // PostgreSQL does not accept bind parameters in CREATE ROLE's PASSWORD clause.
  // format() quotes both values on the server before the generated command runs.
  // Its arguments are variadic "any", so each parameter needs an explicit type.
  const [row] = yield* client<{ statement: string }>`
    SELECT format('CREATE ROLE %I LOGIN PASSWORD %L%s', ${role}::text, ${password}::text, ${attributes}::text) AS statement
  `;
  yield* client.unsafe(row.statement);
});

const main = Effect.gen(function* () {
  const shadowRole = `${config.databaseName}_shadow`;
  const roles = [config.owner, config.authenticator, config.visitor, shadowRole];

  yield* confirmReset(config.databaseName, roles, config.noConfirm);

  const sql = yield* PgClient.PgClient;

  yield* sql`SELECT true`.pipe(
    Effect.retry({
      schedule: Schedule.spaced(Duration.seconds(1)).pipe(Schedule.upTo({ times: 30 })),
      while: (error) => error.isRetryable,
    }),
  );

  yield* Effect.forEach(
    [config.databaseName, `${config.databaseName}_shadow`, `${config.databaseName}_test`],
    (database) => sql`DROP DATABASE IF EXISTS ${sql(database)}`,
    { discard: true },
  );
  yield* Effect.forEach(roles, (role) => sql`DROP ROLE IF EXISTS ${sql(role)}`, { discard: true });

  const ownerPrivilege = config.nodeEnv === "production" ? "" : " SUPERUSER";

  yield* createLoginRole({
    role: config.owner,
    password: config.ownerPassword,
    attributes: ownerPrivilege
  });
  yield* createLoginRole({
    role: config.authenticator,
    password: config.authenticatorPassword,
    attributes: " NOINHERIT"
  });
  yield* sql`CREATE ROLE ${sql(config.visitor)}`;
  yield* createLoginRole({
    role: shadowRole,
    password: config.shadowPassword,
    attributes: " SUPERUSER"
  });
  yield* sql`GRANT ${sql(config.visitor)} TO ${sql(config.authenticator)}`;

  yield* Effect.forEach(
    [
      { database: config.databaseName, owner: config.owner },
      { database: `${config.databaseName}_shadow`, owner: shadowRole },
      { database: `${config.databaseName}_test`, owner: config.owner },
    ],
    ({ database, owner }) => sql`CREATE DATABASE ${sql(database)} OWNER ${sql(owner)}`,
    { discard: true },
  );

  yield* Effect.log(`Created databases and roles for ${config.databaseName}`);
}).pipe(
  // Effect.scoped,
  Effect.provide(PgClient.layer({ url: Redacted.make(config.rootDatabaseUrl), maxConnections: 1 })),
);

main.pipe(Effect.provide(NodeTerminal.layer), NodeRuntime.runMain);
