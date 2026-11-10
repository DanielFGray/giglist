import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema as S } from "effect"
import { HttpClientResponse } from "effect/http"
import { Song } from "../../api/songs"
import { baseUrl, TestHttpClientLive } from "../test/apiHarness"
import { anonymous, createBand, postJson, sendJson, signedIn } from "../test/clients"

const runId = Math.random().toString(36).slice(2, 8)
const song = { title: "Song One", artist: null, key: "G", tempo_bpm: 120, duration_seconds: null, capo: null, notes: null }
const status = (response: HttpClientResponse.HttpClientResponse) => response.status

describe("songs over HTTP", () => {
  it.effect("a member writes and reads the band's songs", () =>
    Effect.gen(function* () {
      const member = yield* signedIn(`song_member_${runId}`)
      const band = yield* createBand(member, `songs-${runId}`)

      const created = yield* postJson(member, "/songs", { ...song, band_id: band.id })
      expect(created.status).toBe(201)
      const { id } = yield* HttpClientResponse.schemaBodyJson(Song)(created)

      const updated = yield* sendJson(member, "PUT", `/songs/${id}`, { key: "A" }).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Song)),
      )
      expect(updated).toMatchObject({ id, title: "Song One", key: "A", tempo_bpm: 120 })

      const listed = yield* member.get(`${baseUrl}/songs/band/${band.id}`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(S.Array(Song))),
      )
      expect(listed.map((s) => s.id)).toEqual([id])

      expect(status(yield* sendJson(member, "DELETE", `/songs/${id}`, {}))).toBe(204)
      expect(status(yield* member.get(`${baseUrl}/songs/${id}`))).toBe(403)
    }).pipe(Effect.provide(TestHttpClientLive)))

  it.effect("a non-member or a signed-out caller is refused", () =>
    Effect.gen(function* () {
      const member = yield* signedIn(`song_owner_${runId}`)
      const outsider = yield* signedIn(`song_outsider_${runId}`)
      const nobody = yield* anonymous
      const band = yield* createBand(member, `songs-closed-${runId}`)
      const { id } = yield* postJson(member, "/songs", { ...song, band_id: band.id }).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Song)),
      )

      for (const client of [outsider, nobody]) {
        expect(status(yield* client.get(`${baseUrl}/songs/${id}`))).toBe(403)
        expect(status(yield* client.get(`${baseUrl}/songs/band/${band.id}`))).toBe(403)
        expect(status(yield* postJson(client, "/songs", { ...song, band_id: band.id }))).toBe(403)
        expect(status(yield* sendJson(client, "PUT", `/songs/${id}`, { title: "Taken" }))).toBe(403)
        expect(status(yield* sendJson(client, "DELETE", `/songs/${id}`, {}))).toBe(403)
      }
      const kept = yield* member.get(`${baseUrl}/songs/${id}`).pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Song)))
      expect(kept.title).toBe("Song One")
    }).pipe(Effect.provide(TestHttpClientLive)))
})
