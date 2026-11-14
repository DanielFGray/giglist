import { Array as Arr, Option, Schema as S } from "effect"
import type { SqlError } from "effect/sql/SqlError"

/** What Postgres reports about a statement it refused (the protocol error fields, see @effect/sql-pg classifyFields). */
export const PostgresReport = S.Struct({
  /** The SQLSTATE: a standard code, or a custom one our SQL functions raise. */
  code: S.String,
  message: S.String,
  detail: S.OptionFromOptional(S.String),
  hint: S.OptionFromOptional(S.String),
  constraint: S.OptionFromOptional(S.String),
})
export type PostgresReport = typeof PostgresReport.Type

/**
 * A failed database call. `report` is none when the failure did not come from
 * Postgres (a lost connection, a driver error). `message` is for the log only:
 * it holds every part of the report and the span that ran the query.
 */
export class DatabaseError extends S.TaggedError<DatabaseError, { readonly brand: unique symbol }>()("DatabaseError", {
  message: S.String,
  report: S.Option(PostgresReport),
  cause: S.Unknown,
}) {}

/** Refinement for generic error channels, where `Effect.catchTag` cannot narrow the tag. */
export const isDatabaseError = S.is(DatabaseError)

/** Whether Postgres refused the query with SQLSTATE `code`. A failure that did not come from Postgres has no code. */
export const hasSqlState = (error: DatabaseError, code: string): boolean =>
  Option.exists(error.report, (report) => report.code === code)

/**
 * Turns a SqlError into a DatabaseError. `@effect/sql-pg` keeps the protocol
 * fields on the reason's cause, so the report is decoded from there; `query`
 * names the span that ran the statement.
 */
export const toDatabaseError = (error: SqlError, query: Option.Option<string>): DatabaseError => {
  const cause = error.reason.cause
  const report = S.decodeUnknownOption(PostgresReport)(cause)
  return new DatabaseError({ message: logMessage(report, query, cause), report, cause })
}

const logMessage = (report: Option.Option<PostgresReport>, query: Option.Option<string>, cause: unknown) =>
  Arr.getSomes([
    Option.some(
      Option.match(report, {
        onNone: () =>
          Option.match(S.decodeUnknownOption(DriverFailure)(cause), {
            onNone: () => "Database call failed",
            onSome: (failure) => `Database call failed: ${failure.message}`,
          }),
        onSome: ({ code, message }) => `[${code}] ${message}`,
      }),
    ),
    Option.map(query, (name) => `query: ${name}`),
    Option.map(Option.flatMap(report, (r) => r.detail), (detail) => `detail: ${detail}`),
    Option.map(Option.flatMap(report, (r) => r.hint), (hint) => `hint: ${hint}`),
    Option.map(Option.flatMap(report, (r) => r.constraint), (constraint) => `constraint: ${constraint}`),
  ]).join("; ")

const DriverFailure = S.Struct({ message: S.String })
