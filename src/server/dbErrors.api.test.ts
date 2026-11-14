import { describe, expect, it } from "@effect/vitest"
import { PgClient } from "@effect/sql-pg"
import { Config, Effect, Layer, Option, Schema as S } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { isSqlError } from "effect/sql/SqlError"
import { DatabaseRefusals } from "../api/errors"
import { FailureBoundary } from "../api/failure-boundary"
import { AuthDb, AuthVisitor, RequestDatabase, withAuthContext } from "./db"
import { toDatabaseError } from "./databaseError"
import { toHttpError } from "./dbErrors"
import { FailureBoundaryLive } from "./failureBoundary"
import { answerRequest, collectLogs, type LogLine } from "./test/probe"

/**
 * Statements that fail the way the app's SQL fails. `usernameTaken` and the
 * visitor insert hit real setlist tables; the custom, other-unique and unknown
 * cases raise the same SQLSTATEs by hand, because no setlist table holds a
 * fixed row that would fail the way each one needs.
 */
const statementNames = ["custom", "usernameTaken", "otherUnique", "divisionByZero", "unknown"] as const
const statements: Record<(typeof statementNames)[number], string> = {
  custom: `do $$ begin
    raise exception 'You are not allowed to do that' using errcode = 'DNIED';
  end $$`,
  usernameTaken: `do $$ begin
    insert into app_public.users (username) values ('dbtest_alice');
    insert into app_public.users (username) values ('dbtest_alice');
  end $$`,
  otherUnique: `do $$ begin
    raise exception 'duplicate key value violates unique constraint "user_emails_user_id_email_key"'
      using errcode = '23505', constraint = 'user_emails_user_id_email_key',
        detail = 'Key (user_id, email)=(c00k1e, alice@example.com) already exists.';
  end $$`,
  divisionByZero: `select 1 / 0`,
  unknown: `do $$ begin
    raise exception 'relation secret_table is broken' using errcode = 'ZZ001',
      hint = 'look at secret_table';
  end $$`,
}

/**
 * Runs a statement the typed query builders cannot express, such as a DO block.
 * A failure takes the conversion a builder's failure takes (effectKysely.ts
 * runQuery), so the handler sees the same DatabaseError.
 */
const runRaw = (statement: string) =>
  Effect.gen(function* () {
    const client = yield* PgClient.PgClient
    return yield* client.unsafe(statement)
  }).pipe(
    Effect.catchIf(isSqlError, (error) =>
      Effect.flatMap(Effect.option(Effect.currentSpan), (enclosing) =>
        Effect.fail(toDatabaseError(error, Option.map(enclosing, (span) => span.name))),
      ),
    ),
  )

const ProbeApi = HttpApi.make("probe")
  .add(
    HttpApiGroup.make("probe")
      .add(
        HttpApiEndpoint.get("raise", "/raise/:name", {
          params: { name: S.Literals(statementNames) },
          success: S.Void.pipe(HttpApiSchema.status(204)),
          error: DatabaseRefusals,
        }),
      )
      .add(
        HttpApiEndpoint.get("visitorInsert", "/visitor-insert", {
          success: S.Void.pipe(HttpApiSchema.status(204)),
          error: DatabaseRefusals,
        }),
      ),
  )
  .middleware(FailureBoundary)

const ProbeHandlers = HttpApiBuilder.group(ProbeApi, "probe", (handlers) =>
  handlers
      .handle(
        "raise",
        Effect.fn("Probe.raise")(
          function* ({ params: { name } }) {
            yield* runRaw(statements[name])
          },
          Effect.catchTag("DatabaseError", toHttpError),
        ),
      )
      .handle(
        "visitorInsert",
        Effect.fn("Probe.visitorInsert")(
          function* () {
            // No session, so the request runs as the visitor, who may not insert a song.
            yield* Effect.gen(function* () {
              const visitor = yield* RequestDatabase
              yield* visitor
                .insertInto("app_public.songs")
                .values({ band_id: "00000000-0000-0000-0000-000000000000", title: "x" })
            }).pipe(withAuthContext)
          },
          Effect.catchTag("DatabaseError", toHttpError),
        ),
      ),
)

const served = HttpApiBuilder.layer(ProbeApi).pipe(
  Layer.provide(ProbeHandlers),
  Layer.provide(FailureBoundaryLive),
  Layer.provideMerge(
    Layer.mergeAll(
      AuthDb.layer,
      AuthVisitor.layer,
      PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") }),
    ),
  ),
  Layer.provide(HttpServer.layerServices),
)

const request = (path: string) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const lines: Array<LogLine> = []
      return { lines, web: HttpRouter.toWebHandler(Layer.provideMerge(served, collectLogs(lines))) }
    }),
    ({ web, lines }) => answerRequest(web, lines, "GET", path),
    ({ web }) => Effect.promise(() => web.dispose()),
  )

describe("toHttpError", () => {
  it.effect("answers a custom code with the text its SQL wrote, and logs the report", () =>
    Effect.gen(function* () {
      const { status, body, lines } = yield* request("/raise/custom")
      expect(status).toBe(403)
      expect(JSON.parse(body)).toEqual({
        _tag: "Forbidden",
        message: "You are not allowed to do that",
        reason: "access_denied",
      })
      expect(lines).toHaveLength(2)
      expect(lines[1]?.message).toEqual(["Sent HTTP response"])
      expect(lines[0]?.level).toBe("Info")
      expect(lines[0]?.cause).toContain("[DNIED] You are not allowed to do that; query: Probe.raise")
    }),
  )

  const fixedAnswers = [
    {
      name: "a unique constraint users can hit, by its name",
      path: "/raise/usernameTaken",
      status: 409,
      body: {
        _tag: "Conflict",
        message: "username already exists",
        reason: "username_taken",
      },
      logged: "detail: Key (username)=(dbtest_alice) already exists.; constraint: users_username_key",
    },
    {
      name: "any other unique constraint",
      path: "/raise/otherUnique",
      status: 409,
      body: {
        _tag: "Conflict",
        message: "That already exists.",
        reason: "already_exists",
      },
      logged: "constraint: user_emails_user_id_email_key",
    },
    {
      name: "a data exception (class 22)",
      path: "/raise/divisionByZero",
      status: 400,
      body: {
        _tag: "InvalidOperation",
        message: "Some values are not valid.",
        reason: "invalid_input",
      },
      logged: "[22012] division by zero",
    },
    {
      name: "a row that row-level security refuses",
      path: "/visitor-insert",
      status: 403,
      body: {
        _tag: "Forbidden",
        message: "You do not have permission to do that.",
        reason: "access_denied",
      },
      logged: '[42501] new row violates row-level security policy for table "songs"',
    },
  ]
  for (const answer of fixedAnswers) {
    it.effect(`answers ${answer.name} with fixed text, and logs the report`, () =>
      Effect.gen(function* () {
        const { status, body, lines } = yield* request(answer.path)
        expect(status).toBe(answer.status)
        expect(JSON.parse(body)).toEqual(answer.body)
        expect(lines).toHaveLength(2)
        expect(lines[1]?.message).toEqual(["Sent HTTP response"])
        expect(lines[0]?.level).toBe("Warn")
        expect(lines[0]?.cause).toContain(answer.logged)
      }),
    )
  }

  it.effect("answers any other code with a 500 whose trace id finds the logged report", () =>
    Effect.gen(function* () {
      const { status, body, lines } = yield* request("/raise/unknown")
      expect(lines).toHaveLength(2)
      expect(lines[1]?.message).toEqual(["Sent HTTP response"])
      const [line] = lines
      expect(line?.level).toBe("Error")
      expect(line?.message).toEqual(["Unexpected failure"])
      expect(line?.cause).toContain(
        "[ZZ001] relation secret_table is broken; query: Probe.raise; hint: look at secret_table",
      )
      expect(status).toBe(500)
      expect(JSON.parse(body)).toEqual({
        _tag: "InternalError",
        message: "Something went wrong on our side.",
        traceId: line?.traceId,
      })
    }),
  )
})
