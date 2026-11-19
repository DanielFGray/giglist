import { Schema as S } from "effect"

/**
 * Row Schemas that several services share. Each describes what the stompbox
 * runner decodes from the statement's rows, so a service names one beside its
 * query; a row only one query returns is declared next to that query.
 */

/** A row that holds just an id: an insert's `returning id`, a lookup, a function's uuid result. */
export const IdRow = S.Struct({ id: S.String })

/** A `select * from fn() as ok` over a function that answers whether it did its work. */
export const OkRow = S.Struct({ ok: S.Boolean })
