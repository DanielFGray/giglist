import { Array as Arr, Effect, Option, Stream } from "effect"
import { Sse } from "effect/encoding"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { BandInfo } from "../../api/bands"
import { LiveEvent } from "../../api/setlists"
import { Song } from "../../api/songs"
import type { LiveEventData } from "../services/live-hub"
import { baseUrl, makeCookieJar } from "./apiHarness"

export const testPassword = "TestUserPassword"

/** POST /auth/register with the test password and `<username>@example.com`. */
export const register = (client: HttpClient.HttpClient, username: string) =>
  HttpClientRequest.post(`${baseUrl}/auth/register`).pipe(
    HttpClientRequest.bodyJson({ username, email: `${username}@example.com`, password: testPassword }),
    Effect.flatMap(client.execute),
  )

/** POST /auth/login; `id` is a username or an email address. */
export const login = (client: HttpClient.HttpClient, id: string, password = testPassword) =>
  HttpClientRequest.post(`${baseUrl}/auth/login`).pipe(
    HttpClientRequest.bodyJson({ id, password }),
    Effect.flatMap(client.execute),
  )

/** POST `path` under the API with a JSON body. */
export const postJson = (client: HttpClient.HttpClient, path: string, body: unknown) =>
  HttpClientRequest.post(`${baseUrl}${path}`).pipe(
    HttpClientRequest.bodyJson(body),
    Effect.flatMap(client.execute),
  )

/** A client with its own cookie jar and no session. */
export const anonymous = Effect.gen(function* () {
  return (yield* HttpClient.HttpClient).pipe(HttpClient.withCookiesRef(yield* makeCookieJar))
})

/** A client with its own cookie jar, signed in as a new user. */
export const signedIn = (username: string) =>
  Effect.gen(function* () {
    const client = yield* anonymous
    const response = yield* register(client, username)
    if (response.status !== 200) return yield* Effect.die(`registering ${username} answered ${response.status}`)
    return client
  })

/** POST /my/bands; the caller becomes its owner. */
export const createBand = (client: HttpClient.HttpClient, slug: string) =>
  postJson(client, "/my/bands", { slug, name: `Band ${slug}` }).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(BandInfo)),
  )

/** `method` on `path` under the API with a JSON body. */
export const sendJson = (client: HttpClient.HttpClient, method: "PUT" | "PATCH" | "DELETE", path: string, body: unknown) =>
  HttpClientRequest.make(method)(`${baseUrl}${path}`).pipe(
    HttpClientRequest.bodyJson(body),
    Effect.flatMap(client.execute),
  )

/** POST /songs: a song in `bandId` with only a title. */
export const createSong = (client: HttpClient.HttpClient, bandId: string, title = "Song") =>
  postJson(client, "/songs", { band_id: bandId, title, artist: null, key: null, tempo_bpm: null, duration_seconds: null, capo: null, notes: null }).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Song)),
  )

/** POST `path` under the API with `bytes` as the body. */
export const postBytes = (client: HttpClient.HttpClient, path: string, bytes: Uint8Array) =>
  HttpClientRequest.post(`${baseUrl}${path}`).pipe(
    HttpClientRequest.bodyUint8Array(bytes),
    client.execute,
  )

/** POST /testing/band-member: make `username` a member of `bandId` without an invitation. */
export const addMember = (client: HttpClient.HttpClient, bandId: string, username: string) =>
  postJson(client, "/testing/band-member", { band_id: bandId, username }).pipe(
    Effect.flatMap((response) =>
      response.status === 200 ? Effect.void : Effect.die(`adding ${username} answered ${response.status}`),
    ),
  )

/**
 * Opens a room's event stream (`path` is `/setlists/:id` or `/gigs/:id`) as a
 * new connection, `client`. Each pull answers the next events; the scope closes it.
 */
export const openRoom = (client: HttpClient.HttpClient, path: string) =>
  Effect.gen(function* () {
    const id = crypto.randomUUID()
    const response = yield* client.get(`${baseUrl}${path}/events`, { urlParams: { client: id } })
    if (response.status !== 200) return yield* Effect.die(`opening ${path} answered ${response.status}`)
    const pull = yield* response.stream.pipe(
      Stream.decodeText(),
      Stream.pipeThroughChannel(Sse.decodeDataSchema(LiveEvent)),
      Stream.map((event) => event.data),
      Stream.toPull,
    )
    return { client: id, pull }
  })

/** Pulls from a room until an event matches, failing after five seconds. */
export const nextEvent = <A extends LiveEventData>(
  { pull }: Effect.Success<ReturnType<typeof openRoom>>,
  match: (event: LiveEventData) => event is A,
) =>
  pull.pipe(
    Effect.map(Arr.findFirst(match)),
    Effect.repeat({ until: Option.isSome }),
    Effect.flatMap(Effect.fromOption),
    Effect.timeout("5 seconds"),
    Effect.orDie,
  )
