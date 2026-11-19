import { Context, Effect, Layer, Schema as S } from "effect"
import { requestDb } from "../db"
import { IdRow } from "../rows"
import { Mark, RevisionStep, Stamp, type MarkInsert, type MarkUpdate, type StampInsert } from "../../api/marks"

export class MarkMissing extends S.TaggedError<MarkMissing, { readonly brand: unique symbol }>()("MarkMissing", {
  message: S.String,
  id: S.String,
}) {}

export class MarkRefused extends S.TaggedError<MarkRefused, { readonly brand: unique symbol }>()("MarkRefused", {
  message: S.String,
}) {}

const MARK_COLUMNS = [
  "id",
  "user_id",
  "revision_id",
  "scope",
  "range_start",
  "range_end",
  "side",
  "dx",
  "dy",
  "scale",
  "body",
  "visibility",
  "created_at",
  "updated_at",
] as const

/**
 * A player's marks on charts, and their stamps (saved mark bodies), read and
 * written as the request's user. The policies limit marks to the caller's own
 * and the band's shared ones, and writes to the caller's own.
 */
export class Marks extends Context.Service<Marks>()("giglist/marks", {
  make: Effect.sync(() => {
    const notMember = () => new MarkRefused({ message: "You are not a member of that band" })

    /**
     * Require that the revision is visible to the caller. RLS hides a chart outside
     * the caller's bands, so a missing revision and a foreign one look the same.
     */
    const requireRevision = Effect.fnUntraced(function* (revisionId: string) {
      const rows = yield* requestDb.all(IdRow, (k) =>
        k.selectFrom("app_public.chart_revisions").select("id").where("id", "=", revisionId),
      )
      if (rows.length === 0) return yield* notMember()
    })

    const listForChart = Effect.fn("Marks.listForChart")(function* (chartId: string) {
      const charts = yield* requestDb.all(IdRow, (k) =>
        k.selectFrom("app_public.charts").select("id").where("id", "=", chartId),
      )
      if (charts.length === 0) return yield* notMember()
      const marks = yield* requestDb.all(Mark, (k) =>
        k
          .selectFrom("app_public.marks as m")
          .innerJoin("app_public.chart_revisions as r", "r.id", "m.revision_id")
          .select(MARK_COLUMNS.map((c) => `m.${c}` as const))

          .where("r.chart_id", "=", chartId)
          .orderBy("m.created_at"),
      )
      if (marks.length === 0) return { marks: [], revisions: [] }
      const oldest = yield* requestDb.one(S.Struct({ created_at: S.Date }), (k) =>
        k
          .selectFrom("app_public.chart_revisions")
          .select("created_at")
          .where(
            "id",
            "in",
            marks.map((m) => m.revision_id),
          )
          .orderBy("created_at")
          .limit(1),
      )
      const revisions = yield* requestDb.all(RevisionStep, (k) =>
        k
          .selectFrom("app_public.chart_revisions")
          .select(["id", "source", "changes"])
          .where("chart_id", "=", chartId)
          .where("created_at", ">=", oldest.created_at)
          .orderBy("created_at")
          .orderBy("id"),
      )
      return { marks, revisions }
    })

    const create = Effect.fn("Marks.create")(function* (payload: typeof MarkInsert.Type) {
      yield* requireRevision(payload.revision_id)
      // user_id is the session's user by default and cannot be set.
      return yield* requestDb.one(Mark, (k) =>
        k.insertInto("app_public.marks").values(placement(payload)).returning(MARK_COLUMNS),
      )
    })

    const update = Effect.fn("Marks.update")(function* (id: string, payload: typeof MarkUpdate.Type) {
      yield* requireRevision(payload.revision_id)
      // The update policy limits this to the caller's own marks.
      const row = yield* requestDb.maybe(Mark, (k) =>
        k.updateTable("app_public.marks").set(placement(payload)).where("id", "=", id).returning(MARK_COLUMNS),
      )
      return yield* Effect.fromOption(row, () => new MarkMissing({ id, message: "That mark was not found" }))
    })

    const remove = Effect.fn("Marks.remove")(function* (id: string) {
      const rows = yield* requestDb.all(IdRow, (k) =>
        k.deleteFrom("app_public.marks").where("id", "=", id).returning("id"),
      )
      if (rows.length === 0) return yield* new MarkMissing({ id, message: "That mark was not found" })
    })

    const listStamps = Effect.fn("Marks.listStamps")(function* () {
      return yield* requestDb.all(Stamp, (k) =>
        k.selectFrom("app_public.stamps").select(["id", "name", "body", "created_at"]).orderBy("created_at"),
      )
    })

    const createStamp = Effect.fn("Marks.createStamp")(function* (payload: typeof StampInsert.Type) {
      return yield* requestDb.one(Stamp, (k) =>
        k
          .insertInto("app_public.stamps")
          .values({ name: payload.name, body: JSON.stringify(payload.body) })
          .returning(["id", "name", "body", "created_at"]),
      )
    })

    const removeStamp = Effect.fn("Marks.removeStamp")(function* (id: string) {
      const rows = yield* requestDb.all(IdRow, (k) =>
        k.deleteFrom("app_public.stamps").where("id", "=", id).returning("id"),
      )
      if (rows.length === 0) return yield* new MarkMissing({ id, message: "That stamp was not found" })
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
