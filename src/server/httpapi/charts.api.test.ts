import { readFileSync } from "node:fs"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema as S } from "effect"
import { HttpClientResponse } from "effect/http"
import { Chart } from "../../api/contracts"
import { baseUrl, TestHttpClientLive } from "../test/apiHarness"
import { anonymous, createBand, createSong, postBytes, postJson, sendJson, signedIn } from "../test/clients"

const runId = Math.random().toString(36).slice(2, 8)
const pasted = "G       C\nAmazing grace how sweet"
const score = new Uint8Array(readFileSync(new URL("../../../tests/fixtures/four-tracks.gp5", import.meta.url)))
const decodeChart = HttpClientResponse.schemaBodyJson(Chart)

describe("charts and scores over HTTP", () => {
  it.effect("a member makes, revises and deletes a lyrics chart", () =>
    Effect.gen(function* () {
      const member = yield* signedIn(`chart_member_${runId}`)
      const band = yield* createBand(member, `charts-${runId}`)
      const song = yield* createSong(member, band.id)

      const created = yield* postJson(member, "/charts", { song_id: song.id, name: "Lyrics", written_key: "G", pasted })
      expect(created.status).toBe(201)
      const chart = yield* decodeChart(created)
      expect(chart).toMatchObject({ song_id: song.id, kind: "lyrics", written_key: "G" })

      const revised = yield* postJson(member, `/charts/${chart.id}/revisions`, { parent_id: chart.revision_id, source: "[G]Amazing grace", changes: null })
      expect(revised.status).toBe(201)
      const saved = yield* decodeChart(revised)
      expect(saved.source).toBe("[G]Amazing grace")

      const stale = yield* postJson(member, `/charts/${chart.id}/revisions`, { parent_id: chart.revision_id, source: "[C]Late", changes: null })
      expect(stale.status).toBe(409)

      const listed = yield* member.get(`${baseUrl}/charts/song/${song.id}`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(S.Array(Chart))))
      expect(listed.map((c) => [c.id, c.revision_id])).toEqual([[chart.id, saved.revision_id]])

      expect((yield* sendJson(member, "DELETE", `/charts/${chart.id}`, {})).status).toBe(204)
      const after = yield* member.get(`${baseUrl}/charts/song/${song.id}`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(S.Array(Chart))))
      expect(after).toEqual([])
    }).pipe(Effect.provide(TestHttpClientLive)))

  it.effect("a member uploads a score and reads its bytes back", () =>
    Effect.gen(function* () {
      const member = yield* signedIn(`score_member_${runId}`)
      const outsider = yield* signedIn(`score_outsider_${runId}`)
      const band = yield* createBand(member, `scores-${runId}`)
      const song = yield* createSong(member, band.id)
      const query = `song_id=${song.id}&name=Tab&file_name=four-tracks.gp5`

      const uploaded = yield* postBytes(member, `/scores?${query}`, score)
      expect(uploaded.status).toBe(201)
      const chart = yield* decodeChart(uploaded)
      expect(chart).toMatchObject({ kind: "score", name: "Tab", source: null })

      const file = yield* member.get(`${baseUrl}/scores/${chart.revision_id}/file`)
      expect(file.status).toBe(200)
      expect(new Uint8Array(yield* file.arrayBuffer)).toEqual(score)

      expect((yield* postBytes(member, `/scores?${query}`, new TextEncoder().encode("not a score"))).status).toBe(400)
      expect((yield* outsider.get(`${baseUrl}/scores/${chart.revision_id}/file`)).status).toBe(403)
      expect((yield* postBytes(outsider, `/scores?${query}`, score)).status).toBe(403)
    }).pipe(Effect.provide(TestHttpClientLive)))

  it.effect("a non-member or a signed-out caller is refused", () =>
    Effect.gen(function* () {
      const member = yield* signedIn(`chart_owner_${runId}`)
      const outsider = yield* signedIn(`chart_outsider_${runId}`)
      const nobody = yield* anonymous
      const band = yield* createBand(member, `charts-closed-${runId}`)
      const song = yield* createSong(member, band.id)
      const chart = yield* postJson(member, "/charts", { song_id: song.id, name: "Lyrics", written_key: null, pasted }).pipe(Effect.flatMap(decodeChart))

      for (const client of [outsider, nobody]) {
        expect((yield* client.get(`${baseUrl}/charts/song/${song.id}`)).status).toBe(403)
        expect((yield* postJson(client, "/charts", { song_id: song.id, name: "Mine", written_key: null, pasted })).status).toBe(403)
        expect((yield* postJson(client, `/charts/${chart.id}/revisions`, { parent_id: chart.revision_id, source: "x", changes: null })).status).toBe(403)
        yield* sendJson(client, "DELETE", `/charts/${chart.id}`, {})
      }
      expect((yield* nobody.get(`${baseUrl}/scores/${chart.revision_id}/file`)).status).toBe(403)
      const kept = yield* member.get(`${baseUrl}/charts/song/${song.id}`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(S.Array(Chart))))
      expect(kept.map((c) => c.revision_id)).toEqual([chart.revision_id])
    }).pipe(Effect.provide(TestHttpClientLive)))
})
