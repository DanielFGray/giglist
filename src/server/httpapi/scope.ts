import { Effect } from "effect"
import { sql } from "kysely"
import { Kysely, withAuthContext } from "../db"
import { CurrentSession, type SessionData } from "../../api/contracts"

/**
 * `current_user_member_band_ids()` is a `setof uuid`, and `select * from
 * fn() as ids` names its single column after the table alias, so each row
 * carries the id under `ids` rather than `band_id` or the function name.
 */
export const memberBandIds = Effect.fnUntraced(function*() {
  const db = yield* Kysely
  return yield* db
    .selectFrom(sql<{ ids: string }>`app_public.current_user_member_band_ids()`.as("ids"))
    .selectAll()
    .pipe(
      Effect.map((rows) => rows.map((r) => r.ids)),
      Effect.orDie,
    )
})

/**
 * Whether the session's user belongs to `bandId`.
 *
 * The RLS policies already refuse a non-member, so this exists to turn "the
 * query returned nothing" into a 403 the browser can show. Both run in the same
 * transaction, so they cannot disagree about who the user is.
 */
export const isBandMember = Effect.fnUntraced(function*(bandId: string) {
  const ids = yield* memberBandIds()
  return ids.includes(bandId)
})

/**
 * Run `query` as the session's user. With no session, fail with `unauthorized()`
 * (each API group has its own 403 error).
 */
export const asSessionOr = <A, E, E2>(
  unauthorized: () => E2,
  query: (session: SessionData) => Effect.Effect<A, E, Kysely>,
) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    if (!session.sessionId) {
      return yield* Effect.fail(unauthorized())
    }
    return yield* query(session).pipe(withAuthContext(session.sessionId))
  })
