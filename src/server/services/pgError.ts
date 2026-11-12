import { isSqlError } from "effect/sql/SqlError"

/** A Postgres failure's SQLSTATE and, for constraint failures, the constraint's name. */
export interface PgError {
  readonly code: string | undefined
  readonly constraint: string | undefined
}

/**
 * Reads the Postgres error under an effect/sql SqlError. `@effect/sql-pg` keeps
 * the protocol error fields (PgConnection.ts classifyFields) as the reason's
 * cause. They carry the SQLSTATE (`code`), including the five-letter codes our
 * SQL functions raise, and the constraint name. Answers undefined for any other failure.
 */
export const pgError = (e: unknown): PgError | undefined => {
  if (!isSqlError(e)) return undefined
  const native = (e.reason as { readonly cause?: unknown }).cause as
    | { readonly code?: unknown; readonly constraint?: unknown }
    | undefined
  const text = (value: unknown) => (typeof value === "string" ? value : undefined)
  return { code: text(native?.code), constraint: text(native?.constraint) }
}
