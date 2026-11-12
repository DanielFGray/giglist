import { Schema as S } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { ChartChange } from "./charts"
import { SessionMiddleware } from "./session"

// --- Marks and stamps schemas ---

/** Ink strokes in em units from the body's top-left. Each point is [x, y, pressure]. */
export const InkBody = S.Struct({
  kind: S.Literal("ink"),
  strokes: S.Array(S.Array(S.Tuple([S.Finite, S.Finite, S.Finite])).pipe(S.check(S.isMaxLength(5000)))).pipe(
    S.check(S.isMaxLength(200)),
  ),
  width: S.Finite,
  height: S.Finite,
})

export const TextBody = S.Struct({
  kind: S.Literal("text"),
  text: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(2000))),
})

export const MarkBody = S.Union([InkBody, TextBody])

/** What a mark's range counts: characters of a lyrics chart's anchor text. */
export const MarkScope = S.Struct({ kind: S.Literal("chart") })

const markPlacement = {
  revision_id: S.String.check(S.isUUID()),
  scope: MarkScope,
  range_start: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  range_end: S.Int.check(S.isGreaterThanOrEqualTo(1)),
  side: S.Literals(["inline", "margin"]),
  dx: S.Finite,
  dy: S.Finite,
  scale: S.Finite.pipe(S.check(S.isGreaterThan(0))),
  body: MarkBody,
  visibility: S.Literals(["private", "band"]),
}

export const MarkInsert = S.Struct(markPlacement)

/** The whole mark is sent on update: moving one anchors it again, to the revision it was dropped on. */
export const MarkUpdate = S.Struct(markPlacement)

export const Mark = S.Struct({
  id: S.String.check(S.isUUID()),
  user_id: S.String.check(S.isUUID()),
  ...markPlacement,
  created_at: S.Date,
  updated_at: S.Date,
})

/** One revision of a chart, as the browser needs it to follow a mark: its text and the change set the editor recorded. */
export const RevisionStep = S.Struct({
  id: S.String.check(S.isUUID()),
  source: S.NullOr(S.String),
  changes: S.NullOr(S.Array(ChartChange)),
})

/**
 * The marks a player can see on a chart (their own and the band's shared
 * ones), with every revision from the oldest of those marks' revisions on, in
 * order. Following a mark across them needs no further request.
 */
export const ChartMarks = S.Struct({
  marks: S.Array(Mark),
  revisions: S.Array(RevisionStep),
})

export const Stamp = S.Struct({
  id: S.String.check(S.isUUID()),
  name: S.String,
  body: MarkBody,
  created_at: S.Date,
})

export const StampInsert = S.Struct({
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))),
  body: MarkBody,
})

export class MarkForbidden extends S.TaggedError<MarkForbidden, { readonly brand: unique symbol }>()("MarkForbidden", {
  message: S.String,
}, { httpApiStatus: 403 }) {}

export class MarkNotFound extends S.TaggedError<MarkNotFound, { readonly brand: unique symbol }>()("MarkNotFound", {
  message: S.String,
  id: S.String.check(S.isUUID()),
}, { httpApiStatus: 404 }) {}

export const MarksApiGroup = HttpApiGroup.make("marks")
  .add(
    HttpApiEndpoint.get("listMarks", "/chart/:chartId", {
      params: { chartId: S.String.check(S.isUUID()) },
      success: ChartMarks,
      error: MarkForbidden,
    }),
  )
  .add(
    HttpApiEndpoint.post("createMark", "/", {
      payload: MarkInsert,
      success: Mark.pipe(HttpApiSchema.status(201)),
      error: MarkForbidden,
    }),
  )
  .add(
    HttpApiEndpoint.put("updateMark", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      payload: MarkUpdate,
      success: Mark,
      error: [MarkNotFound, MarkForbidden],
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteMark", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      error: [MarkNotFound, MarkForbidden],
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/marks")

export const StampsApiGroup = HttpApiGroup.make("stamps")
  .add(
    HttpApiEndpoint.get("listStamps", "/", {
      success: S.Array(Stamp),
      error: MarkForbidden,
    }),
  )
  .add(
    HttpApiEndpoint.post("createStamp", "/", {
      payload: StampInsert,
      success: Stamp.pipe(HttpApiSchema.status(201)),
      error: MarkForbidden,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteStamp", "/:id", {
      params: { id: S.String.check(S.isUUID()) },
      error: [MarkNotFound, MarkForbidden],
    }),
  )
  .middleware(SessionMiddleware)
  .prefix("/api/stamps")
