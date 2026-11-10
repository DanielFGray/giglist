import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema as S } from "effect"
import { HttpClientResponse } from "effect/http"
import { Chart, ChartMarks, Mark, Stamp } from "../../api/contracts"
import { baseUrl, TestHttpClientLive } from "../test/apiHarness"
import { addMember, anonymous, createBand, createSong, postJson, sendJson, signedIn } from "../test/clients"

const runId = Math.random().toString(36).slice(2, 8)
const text = (value: string) => ({ kind: "text", text: value })
const markOn = (revisionId: string, visibility: "private" | "band", body = text("breathe")) => ({
  revision_id: revisionId,
  scope: { kind: "chart" },
  range_start: 0,
  range_end: 4,
  side: "inline",
  dx: 0,
  dy: -1,
  scale: 1,
  body,
  visibility,
})

const chartFor = (bandSlug: string, username: string) =>
  Effect.gen(function* () {
    const member = yield* signedIn(username)
    const band = yield* createBand(member, bandSlug)
    const song = yield* createSong(member, band.id)
    const chart = yield* postJson(member, "/charts", { song_id: song.id, name: "Lyrics", written_key: null, pasted: "G\nAmazing grace" }).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Chart)),
    )
    return { member, band, chart }
  })

describe("marks and stamps over HTTP", () => {
  it.effect("a member sees their own marks and the band's shared ones", () =>
    Effect.gen(function* () {
      const { member, band, chart } = yield* chartFor(`marks-${runId}`, `mark_member_${runId}`)
      const bandmateName = `mark_bandmate_${runId}`
      const bandmate = yield* signedIn(bandmateName)
      yield* addMember(member, band.id, bandmateName)

      const created = yield* postJson(member, "/marks", markOn(chart.revision_id, "private"))
      expect(created.status).toBe(201)
      const own = yield* HttpClientResponse.schemaBodyJson(Mark)(created)
      const shared = yield* postJson(member, "/marks", markOn(chart.revision_id, "band", text("shared"))).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Mark)),
      )

      const moved = yield* sendJson(member, "PUT", `/marks/${own.id}`, { ...markOn(chart.revision_id, "private"), dx: 2 }).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Mark)),
      )
      expect(moved.dx).toBe(2)

      const listMarks = (client: typeof member) =>
        client.get(`${baseUrl}/marks/chart/${chart.id}`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(ChartMarks)))
      const mine = yield* listMarks(member)
      expect(mine.marks.map((m) => m.id).sort()).toEqual([own.id, shared.id].sort())
      expect(mine.revisions.map((r) => r.id)).toEqual([chart.revision_id])
      const theirs = yield* listMarks(bandmate)
      expect(theirs.marks.map((m) => m.id)).toEqual([shared.id])

      // The update and delete policies cover the caller's own marks only.
      expect((yield* sendJson(bandmate, "PUT", `/marks/${shared.id}`, markOn(chart.revision_id, "band"))).status).toBe(404)
      expect((yield* sendJson(bandmate, "DELETE", `/marks/${shared.id}`, {})).status).toBe(404)
      expect((yield* sendJson(member, "DELETE", `/marks/${own.id}`, {})).status).toBe(204)
      expect((yield* listMarks(member)).marks.map((m) => m.id)).toEqual([shared.id])
    }).pipe(Effect.provide(TestHttpClientLive)))

  it.effect("a stamp belongs to the user who made it", () =>
    Effect.gen(function* () {
      const owner = yield* signedIn(`stamp_owner_${runId}`)
      const other = yield* signedIn(`stamp_other_${runId}`)
      const created = yield* postJson(owner, "/stamps", { name: "Breath", body: text("V") })
      expect(created.status).toBe(201)
      const stamp = yield* HttpClientResponse.schemaBodyJson(Stamp)(created)

      const listStamps = (client: typeof owner) =>
        client.get(`${baseUrl}/stamps`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(S.Array(Stamp))))
      expect((yield* listStamps(owner)).map((s) => s.id)).toEqual([stamp.id])
      expect(yield* listStamps(other)).toEqual([])
      expect((yield* sendJson(other, "DELETE", `/stamps/${stamp.id}`, {})).status).toBe(404)
      expect((yield* sendJson(owner, "DELETE", `/stamps/${stamp.id}`, {})).status).toBe(204)
      expect(yield* listStamps(owner)).toEqual([])
    }).pipe(Effect.provide(TestHttpClientLive)))

  it.effect("a non-member or a signed-out caller is refused", () =>
    Effect.gen(function* () {
      const { member, chart } = yield* chartFor(`marks-closed-${runId}`, `mark_owner_${runId}`)
      const outsider = yield* signedIn(`mark_outsider_${runId}`)
      const nobody = yield* anonymous
      const mark = yield* postJson(member, "/marks", markOn(chart.revision_id, "band")).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Mark)))

      for (const client of [outsider, nobody]) {
        expect((yield* client.get(`${baseUrl}/marks/chart/${chart.id}`)).status).toBe(403)
        expect((yield* postJson(client, "/marks", markOn(chart.revision_id, "band"))).status).toBe(403)
        expect((yield* sendJson(client, "PUT", `/marks/${mark.id}`, markOn(chart.revision_id, "band"))).status).toBe(403)
      }
      expect((yield* sendJson(outsider, "DELETE", `/marks/${mark.id}`, {})).status).toBe(404)
      expect((yield* sendJson(nobody, "DELETE", `/marks/${mark.id}`, {})).status).toBe(403)
      expect((yield* nobody.get(`${baseUrl}/stamps`)).status).toBe(403)
      expect((yield* postJson(nobody, "/stamps", { name: "x", body: text("x") })).status).toBe(403)
    }).pipe(Effect.provide(TestHttpClientLive)))
})
