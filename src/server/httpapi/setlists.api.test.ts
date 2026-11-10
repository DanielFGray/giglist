import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema as S } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Gig, GigEntry, Setlist, SetlistEntry } from "../../api/contracts"
import type { LiveEventData } from "../services/live-hub"
import { baseUrl, TestHttpClientLive } from "../test/apiHarness"
import { anonymous, createBand, createSong, nextEvent, openRoom, postJson, sendJson, signedIn } from "../test/clients"

const runId = Math.random().toString(36).slice(2, 8)
const noDetails = { venue: null, gig_date: null, address: null, load_in_time: null, performance_time: null, notes: null }
const body = <A, I>(schema: S.Codec<A, I>) => HttpClientResponse.schemaBodyJson(schema)
const getJson = <A, I>(client: HttpClient.HttpClient, path: string, schema: S.Codec<A, I>) =>
  client.get(`${baseUrl}${path}`).pipe(Effect.flatMap(body(schema)))

const changedBy = (by: string) => (event: LiveEventData): event is Extract<LiveEventData, { kind: "changed" }> =>
  event.kind === "changed" && event.by === by
const viewers = (count: number) => (event: LiveEventData): event is Extract<LiveEventData, { kind: "presence" }> =>
  event.kind === "presence" && event.viewers.length === count

/**
 * Opens `path`'s room and returns it once it hears change events: the hub
 * subscribes a connection after its first presence list, so the test opens a
 * second connection and waits for the first to see it.
 */
const listeningRoom = (client: HttpClient.HttpClient, path: string) =>
  Effect.gen(function* () {
    const room = yield* openRoom(client, path)
    yield* nextEvent(room, viewers(1))
    const second = yield* openRoom(client, path)
    yield* nextEvent(room, viewers(2))
    return { room, second }
  })

const bandWithSongs = (slug: string, username: string) =>
  Effect.gen(function* () {
    const member = yield* signedIn(username)
    const band = yield* createBand(member, slug)
    const first = yield* createSong(member, band.id, "First")
    const second = yield* createSong(member, band.id, "Second")
    return { member, band, songs: [first, second] as const }
  })

const newSetlist = (client: HttpClient.HttpClient, bandId: string, name: string, songIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const setlist = yield* postJson(client, "/setlists", { band_id: bandId, name }).pipe(Effect.flatMap(body(Setlist)))
    const entries = yield* Effect.forEach(songIds, (song_id) =>
      postJson(client, `/setlists/${setlist.id}/entries`, { song_id }).pipe(Effect.flatMap(body(SetlistEntry))),
    )
    return { setlist, entries }
  })

describe("setlists and gigs over HTTP", () => {
  it.effect("a member builds and reorders a setlist, and its room hears each write", () =>
    Effect.gen(function* () {
      const username = `setlist_member_${runId}`
      const { member, band, songs } = yield* bandWithSongs(`setlists-${runId}`, username)
      const created = yield* postJson(member, "/setlists", { band_id: band.id, name: "Main" })
      expect(created.status).toBe(201)
      const setlist = yield* body(Setlist)(created)
      const { room, second } = yield* listeningRoom(member, `/setlists/${setlist.id}`)

      const added = yield* postJson(member, `/setlists/${setlist.id}/entries`, { song_id: songs[0].id })
      expect(added.status).toBe(201)
      const a = yield* body(SetlistEntry)(added)
      yield* nextEvent(room, changedBy(username))
      const b = yield* postJson(member, `/setlists/${setlist.id}/entries`, { song_id: songs[1].id }).pipe(Effect.flatMap(body(SetlistEntry)))

      const overridden = yield* sendJson(member, "PUT", `/setlists/${setlist.id}/entries/${a.id}`, { key_override: "D" }).pipe(
        Effect.flatMap(body(SetlistEntry)),
      )
      expect(overridden).toMatchObject({ key: "D", key_overridden: true, title: "First" })

      expect((yield* sendJson(member, "PUT", `/setlists/${setlist.id}/move`, { id: b.id, previous: null })).status).toBe(204)
      yield* nextEvent(room, changedBy(username))
      const entries = yield* getJson(member, `/setlists/${setlist.id}/entries`, S.Array(SetlistEntry))
      expect(entries.map((e) => e.id)).toEqual([b.id, a.id])

      // A performing connection reports its song number to the room.
      expect((yield* postJson(member, `/setlists/${setlist.id}/presence`, { client: second.client, mode: "performing", at: 2 })).status).toBe(204)
      const presence = yield* nextEvent(room, viewers(2))
      expect(presence.viewers.find((v) => v.client === second.client)).toMatchObject({ mode: "performing", at: 2 })

      const renamed = yield* sendJson(member, "PUT", `/setlists/${setlist.id}`, { name: "Main set", status: "final" }).pipe(Effect.flatMap(body(Setlist)))
      expect(renamed).toMatchObject({ name: "Main set", status: "final", song_count: 2 })

      const copied = yield* postJson(member, `/setlists/${setlist.id}/copy`, { name: "Copy" })
      expect(copied.status).toBe(201)
      const copy = yield* body(Setlist)(copied)
      const copyEntries = yield* getJson(member, `/setlists/${copy.id}/entries`, S.Array(SetlistEntry))
      expect(copyEntries.map((e) => [e.song_id, e.key])).toEqual([[songs[1].id, null], [songs[0].id, "D"]])

      expect((yield* sendJson(member, "DELETE", `/setlists/${setlist.id}/entries/${a.id}`, {})).status).toBe(204)
      const listed = yield* getJson(member, `/setlists/band/${band.id}`, S.Array(Setlist))
      expect(listed.map((s) => [s.name, s.song_count])).toEqual([["Copy", 2], ["Main set", 1]])
      expect((yield* sendJson(member, "DELETE", `/setlists/${setlist.id}`, {})).status).toBe(204)
      expect((yield* member.get(`${baseUrl}/setlists/${setlist.id}`)).status).toBe(404)
    }).pipe(Effect.scoped, Effect.provide(TestHttpClientLive)))

  it.effect("a gig plays setlists in order, and a write to either reaches both rooms", () =>
    Effect.gen(function* () {
      const username = `gig_member_${runId}`
      const { member, band, songs } = yield* bandWithSongs(`gigs-${runId}`, username)
      const opener = yield* newSetlist(member, band.id, "Opener", [songs[0].id])
      const closer = yield* newSetlist(member, band.id, "Closer", [songs[1].id])

      const created = yield* postJson(member, "/gigs", { band_id: band.id, ...noDetails, venue: "The Hall", gig_date: "2030-01-02", performance_time: "21:00" })
      expect(created.status).toBe(201)
      const gig = yield* body(Gig)(created)
      expect(gig).toMatchObject({ venue: "The Hall", gig_date: "2030-01-02", setlists: [] })

      const gigRoom = yield* listeningRoom(member, `/gigs/${gig.id}`)
      const closerRoom = yield* listeningRoom(member, `/setlists/${closer.setlist.id}`)

      yield* postJson(member, `/gigs/${gig.id}/setlists`, { setlist_id: closer.setlist.id }).pipe(Effect.flatMap(body(Gig)))
      yield* nextEvent(closerRoom.room, changedBy(username))
      const both = yield* postJson(member, `/gigs/${gig.id}/setlists`, { setlist_id: opener.setlist.id }).pipe(Effect.flatMap(body(Gig)))
      expect(both.setlists.map((s) => s.name)).toEqual(["Closer", "Opener"])
      expect((yield* postJson(member, `/gigs/${gig.id}/setlists`, { setlist_id: opener.setlist.id })).status).toBe(403)

      const moved = yield* sendJson(member, "PUT", `/gigs/${gig.id}/setlists/move`, { id: opener.setlist.id, previous: null }).pipe(Effect.flatMap(body(Gig)))
      expect(moved.setlists.map((s) => s.name)).toEqual(["Opener", "Closer"])
      const played = yield* getJson(member, `/gigs/${gig.id}/entries`, S.Array(GigEntry))
      expect(played.map((e) => [e.setlist_name, e.title])).toEqual([["Opener", "First"], ["Closer", "Second"]])

      // A write to a setlist reaches every gig that plays it.
      yield* sendJson(member, "PUT", `/setlists/${closer.setlist.id}`, { status: "rehearsal" })
      yield* nextEvent(gigRoom.room, changedBy(username))

      const other = yield* postJson(member, "/gigs", { band_id: band.id, ...noDetails, venue: "Elsewhere" }).pipe(Effect.flatMap(body(Gig)))
      yield* postJson(member, `/gigs/${other.id}/setlists`, { setlist_id: closer.setlist.id })
      const shared = yield* getJson(member, `/gigs/${gig.id}`, Gig)
      expect(shared.setlists.map((s) => [s.name, s.gig_count])).toEqual([["Opener", 1], ["Closer", 2]])
      const copied = yield* postJson(member, `/gigs/${gig.id}/setlists/${closer.setlist.id}/copy`, { name: "Closer, this gig" }).pipe(Effect.flatMap(body(Gig)))
      expect(copied.setlists.map((s) => [s.name, s.gig_count])).toEqual([["Opener", 1], ["Closer, this gig", 1]])
      expect((yield* getJson(member, `/gigs/${other.id}`, Gig)).setlists.map((s) => s.id)).toEqual([closer.setlist.id])

      const updated = yield* sendJson(member, "PUT", `/gigs/${gig.id}`, { ...noDetails, venue: "The Big Hall", load_in_time: "18:30" }).pipe(Effect.flatMap(body(Gig)))
      // The database answers a time with seconds.
      expect(updated).toMatchObject({ venue: "The Big Hall", gig_date: null, load_in_time: "18:30:00" })
      const removed = yield* sendJson(member, "DELETE", `/gigs/${gig.id}/setlists/${opener.setlist.id}`, {}).pipe(Effect.flatMap(body(Gig)))
      expect(removed.setlists.map((s) => s.name)).toEqual(["Closer, this gig"])
      const listed = yield* getJson(member, `/gigs/band/${band.id}`, S.Array(Gig))
      // Gigs without a date list newest first.
      expect(listed.map((g) => g.venue)).toEqual(["Elsewhere", "The Big Hall"])
      expect((yield* sendJson(member, "DELETE", `/gigs/${gig.id}`, {})).status).toBe(204)
      expect((yield* member.get(`${baseUrl}/gigs/${gig.id}`)).status).toBe(404)
    }).pipe(Effect.scoped, Effect.provide(TestHttpClientLive)))

  it.effect("a non-member or a signed-out caller is refused", () =>
    Effect.gen(function* () {
      const { member, band, songs } = yield* bandWithSongs(`setlists-closed-${runId}`, `setlist_owner_${runId}`)
      const { setlist, entries } = yield* newSetlist(member, band.id, "Private", [songs[0].id])
      const gig = yield* postJson(member, "/gigs", { band_id: band.id, ...noDetails }).pipe(Effect.flatMap(body(Gig)))
      const outsider = yield* signedIn(`setlist_outsider_${runId}`)
      const nobody = yield* anonymous

      // Row-level security hides another band's setlist or gig: a 404 to a
      // signed-in outsider. A signed-out caller is refused before any read.
      for (const [client, hidden] of [[outsider, 404], [nobody, 403]] as const) {
        expect((yield* client.get(`${baseUrl}/setlists/band/${band.id}`)).status).toBe(403)
        expect((yield* postJson(client, "/setlists", { band_id: band.id, name: "Mine" })).status).toBe(403)
        expect((yield* client.get(`${baseUrl}/setlists/${setlist.id}`)).status).toBe(hidden)
        expect((yield* client.get(`${baseUrl}/setlists/${setlist.id}/entries`)).status).toBe(hidden)
        expect((yield* sendJson(client, "PUT", `/setlists/${setlist.id}`, { name: "Taken" })).status).toBe(hidden)
        expect((yield* postJson(client, `/setlists/${setlist.id}/entries`, { song_id: songs[1].id })).status).toBe(hidden)
        expect((yield* sendJson(client, "PUT", `/setlists/${setlist.id}/move`, { id: entries[0].id, previous: null })).status).toBe(hidden)
        expect((yield* client.get(`${baseUrl}/setlists/${setlist.id}/events`, { urlParams: { client: crypto.randomUUID() } })).status).toBe(hidden)
        expect((yield* sendJson(client, "DELETE", `/setlists/${setlist.id}`, {})).status).toBe(hidden)

        expect((yield* client.get(`${baseUrl}/gigs/band/${band.id}`)).status).toBe(403)
        expect((yield* postJson(client, "/gigs", { band_id: band.id, ...noDetails })).status).toBe(403)
        expect((yield* client.get(`${baseUrl}/gigs/${gig.id}`)).status).toBe(hidden)
        expect((yield* postJson(client, `/gigs/${gig.id}/setlists`, { setlist_id: setlist.id })).status).toBe(hidden)
        expect((yield* client.get(`${baseUrl}/gigs/${gig.id}/events`, { urlParams: { client: crypto.randomUUID() } })).status).toBe(hidden)
        expect((yield* sendJson(client, "DELETE", `/gigs/${gig.id}`, {})).status).toBe(hidden)
      }
      expect((yield* getJson(member, `/setlists/${setlist.id}`, Setlist)).name).toBe("Private")
      expect((yield* getJson(member, `/gigs/${gig.id}`, Gig)).setlists).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(TestHttpClientLive)))
})
