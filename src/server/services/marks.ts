import { Context, Effect, Layer, Schema as S } from "effect"
import { RequestDatabase } from "../db"
import { ChartMarks, Mark, MarkForbidden, MarkNotFound, Stamp, type MarkInsert, type MarkUpdate, type StampInsert } from "../../api/marks"

const decodeMark = S.decodeUnknownEffect(Mark)
const decodeChartMarks = S.decodeUnknownEffect(ChartMarks)
const decodeStamp = S.decodeUnknownEffect(Stamp)
const decodeStamps = S.decodeUnknownEffect(S.Array(Stamp))

const MARK_COLUMNS = [
  "id", "user_id", "revision_id", "scope", "range_start", "range_end", "side", "dx", "dy", "scale", "body",
  "visibility", "created_at", "updated_at",
] as const

/**
 * A player's marks on charts, and their stamps (saved mark bodies), read and
 * written as the request's user. The policies limit marks to the caller's own
 * and the band's shared ones, and writes to the caller's own.
 */
export class Marks extends Context.Service<Marks>()("setlist/Marks", {
  make: Effect.sync(() => {
    const notMember = () => new MarkForbidden({ message: "You are not a member of that band" })

    /**
     * Require that the revision is visible to the caller. RLS hides a chart outside
     * the caller's bands, so a missing revision and a foreign one look the same.
     */
    const requireRevision = Effect.fnUntraced(function* (revisionId: string) {
      const db = yield* RequestDatabase
      const rows = yield* db.selectFrom("app_public.chart_revisions").select("id").where("id", "=", revisionId).pipe(Effect.orDie)
      if (rows.length === 0) return yield* notMember()
    })

    const listForChart = Effect.fn("Marks.listForChart")(function* (chartId: string) {
      const db = yield* RequestDatabase
      const charts = yield* db.selectFrom("app_public.charts").select("id").where("id", "=", chartId).pipe(Effect.orDie)
      if (charts.length === 0) return yield* notMember()
      const marks = yield* db
        .selectFrom("app_public.marks as m")
        .innerJoin("app_public.chart_revisions as r", "r.id", "m.revision_id")
        .select(MARK_COLUMNS.map((c) => `m.${c}` as const))
        .where("r.chart_id", "=", chartId)
        .orderBy("m.created_at")
        .pipe(Effect.orDie)
      if (marks.length === 0) return yield* decodeChartMarks({ marks: [], revisions: [] }).pipe(Effect.orDie)
      const oldest = yield* db
        .selectFrom("app_public.chart_revisions")
        .select("created_at")
        .where("id", "in", marks.map((m) => m.revision_id))
        .orderBy("created_at")
        .limit(1)
        .pipe(Effect.head, Effect.orDie)
      const revisions = yield* db
        .selectFrom("app_public.chart_revisions")
        .select(["id", "source", "changes"])
        .where("chart_id", "=", chartId)
        .where("created_at", ">=", oldest.created_at)
        .orderBy("created_at")
        .orderBy("id")
        .pipe(Effect.orDie)
      return yield* decodeChartMarks({ marks, revisions }).pipe(Effect.orDie)
    })

    const create = Effect.fn("Marks.create")(function* (payload: typeof MarkInsert.Type) {
      const db = yield* RequestDatabase
      yield* requireRevision(payload.revision_id)
      // user_id is the session's user by default and cannot be set.
      const row = yield* db
        .insertInto("app_public.marks")
        .values(placement(payload))
        .returning(MARK_COLUMNS)
        .pipe(Effect.head, Effect.orDie)
      return yield* decodeMark(row).pipe(Effect.orDie)
    })

    const update = Effect.fn("Marks.update")(function* (id: string, payload: typeof MarkUpdate.Type) {
      const db = yield* RequestDatabase
      yield* requireRevision(payload.revision_id)
      // The update policy limits this to the caller's own marks.
      const [row] = yield* db
        .updateTable("app_public.marks")
        .set(placement(payload))
        .where("id", "=", id)
        .returning(MARK_COLUMNS)
        .pipe(Effect.orDie)
      if (!row) return yield* new MarkNotFound({ id })
      return yield* decodeMark(row).pipe(Effect.orDie)
    })

    const remove = Effect.fn("Marks.remove")(function* (id: string) {
      const db = yield* RequestDatabase
      const rows = yield* db.deleteFrom("app_public.marks").where("id", "=", id).returning("id").pipe(Effect.orDie)
      if (rows.length === 0) return yield* new MarkNotFound({ id })
    })

    const listStamps = Effect.fn("Marks.listStamps")(function* () {
      const db = yield* RequestDatabase
      const rows = yield* db
        .selectFrom("app_public.stamps")
        .select(["id", "name", "body", "created_at"])
        .orderBy("created_at")
        .pipe(Effect.orDie)
      return yield* decodeStamps(rows).pipe(Effect.orDie)
    })

    const createStamp = Effect.fn("Marks.createStamp")(function* (payload: typeof StampInsert.Type) {
      const db = yield* RequestDatabase
      const row = yield* db
        .insertInto("app_public.stamps")
        .values({ name: payload.name, body: JSON.stringify(payload.body) })
        .returning(["id", "name", "body", "created_at"])
        .pipe(Effect.head, Effect.orDie)
      return yield* decodeStamp(row).pipe(Effect.orDie)
    })

    const removeStamp = Effect.fn("Marks.removeStamp")(function* (id: string) {
      const db = yield* RequestDatabase
      const rows = yield* db.deleteFrom("app_public.stamps").where("id", "=", id).returning("id").pipe(Effect.orDie)
      if (rows.length === 0) return yield* new MarkNotFound({ id })
    })

    return { listForChart, create, update, remove, listStamps, createStamp, removeStamp }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

/** The columns the caller may set, from the wire payload to the table. */
const placement = (payload: typeof MarkInsert.Type) => ({
  revision_id: payload.revision_id,
  scope: JSON.stringify(payload.scope),
  range_start: payload.range_start,
  range_end: payload.range_end,
  side: payload.side,
  dx: payload.dx,
  dy: payload.dy,
  scale: payload.scale,
  body: JSON.stringify(payload.body),
  visibility: payload.visibility,
})
