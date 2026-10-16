import { Effect, ManagedRuntime, Schema as S } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import {
  SetListApi,
  AuthUser as AuthUserSchema,
  BandInfo as BandInfoSchema,
  BandMember as BandMemberSchema,
  BandInvitation as BandInvitationSchema,
  Setlist as SetlistSchema,
  SetlistEntry as SetlistEntrySchema,
  SetlistSection as SetlistSectionSchema,
  Song,
  Chart as ChartSchema,
  ChartMarks as ChartMarksSchema,
  Mark as MarkSchema,
  Stamp as StampSchema,
} from "./contracts"

// --- Types derived from contract schemas ---

export type SongInfo = S.Schema.Type<typeof Song>
export type ChartInfo = S.Schema.Type<typeof ChartSchema>
export type MarkInfo = S.Schema.Type<typeof MarkSchema>
export type ChartMarksInfo = S.Schema.Type<typeof ChartMarksSchema>
export type StampInfo = S.Schema.Type<typeof StampSchema>
export type AuthUser = S.Schema.Type<typeof AuthUserSchema>
export type BandInfo = S.Schema.Type<typeof BandInfoSchema>
export type BandMember = S.Schema.Type<typeof BandMemberSchema>
export type BandInvitationInfo = S.Schema.Type<typeof BandInvitationSchema>
export type SetlistInfo = S.Schema.Type<typeof SetlistSchema>
export type SetlistEntryInfo = S.Schema.Type<typeof SetlistEntrySchema>
export type SetlistSectionInfo = S.Schema.Type<typeof SetlistSectionSchema>

/** The payloads each endpoint declares, taken from the contract so the client
 *  never restates the shape the server validates. */
type SongsClient = Effect.Success<SetListApiClient>["songs"]
export type SongCreateData = Parameters<SongsClient["songCreate"]>[0]["payload"]
export type SongUpdateData = Parameters<SongsClient["songUpdate"]>[0]["payload"]

type ChartsClient = Effect.Success<SetListApiClient>["charts"]
export type LyricsChartCreateData = Parameters<ChartsClient["createLyricsChart"]>[0]["payload"]
export type ChartRevisionData = Parameters<ChartsClient["saveRevision"]>[0]["payload"]

type MarksClient = Effect.Success<SetListApiClient>["marks"]
export type MarkData = Parameters<MarksClient["createMark"]>[0]["payload"]
type StampsClient = Effect.Success<SetListApiClient>["stamps"]
export type StampData = Parameters<StampsClient["createStamp"]>[0]["payload"]

type SetlistsClient = Effect.Success<SetListApiClient>["setlists"]
export type SetlistCreateData = Parameters<SetlistsClient["createSetlist"]>[0]["payload"]
export type SetlistUpdateData = Parameters<SetlistsClient["updateSetlist"]>[0]["payload"]
export type SetlistEntryCreateData = Parameters<SetlistsClient["addEntry"]>[0]["payload"]
export type SetlistEntryUpdateData = Parameters<SetlistsClient["updateEntry"]>[0]["payload"]
export type SetlistArrangementData = Parameters<SetlistsClient["arrange"]>[0]["payload"]
export type SetlistPresenceData = Parameters<SetlistsClient["reportPresence"]>[0]["payload"]

/** The auth payloads, likewise taken from the contract. The password is a
 *  `Redacted` here, so the browser form builds one before it calls the API. */
type AuthClient = Effect.Success<SetListApiClient>["auth"]
export type LoginData = Parameters<AuthClient["login"]>[0]["payload"]
export type RegisterData = Parameters<AuthClient["register"]>[0]["payload"]

// --- Client runtime ---

const runtime = ManagedRuntime.make(FetchHttpClient.layer)

/**
 * Run a request on the shared runtime. A failure rejects the promise, so a
 * failed request can never be mistaken for a successful empty value: the
 * router's error boundary reports a load failure, and each form reports a
 * submit failure beside its fields.
 */
const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
): Promise<A> => runtime.runPromise(effect)

// --- Typed API client (one client for the unified API) ---

const api = HttpApiClient.make(SetListApi, { baseUrl: window.location.origin })
type SetListApiClient = typeof api

// --- Auth ---

export const auth = {
  me: () => run(api.pipe(Effect.flatMap((c) => c.auth.me({})))),

  login: (data: LoginData) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.login({ payload: data })))),

  register: (data: RegisterData) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.register({ payload: data })))),

  logout: () => run(api.pipe(Effect.flatMap((c) => c.auth.logout({})))),
}

// --- Bands ---

export const bands = {
  list: () => run(api.pipe(Effect.flatMap((c) => c.myBands.listBands({})))),

  members: (bandId: string) =>
    run(
      api.pipe(Effect.flatMap((c) => c.myBands.getBandMembers({ params: { bandId } }))),
    ),

  create: (data: { slug: string; name: string }) =>
    run(api.pipe(Effect.flatMap((c) => c.myBands.createBand({ payload: data })))),

  delete: (bandId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.myBands.deleteBand({ params: { bandId } })))),

  invitations: () => run(api.pipe(Effect.flatMap((c) => c.myBands.listInvitations({})))),

  acceptInvitation: (invitationId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.myBands.acceptInvitation({ params: { invitationId } })))),

  declineInvitation: (invitationId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.myBands.declineInvitation({ params: { invitationId } })))),

  invite: (bandId: string, data: { username?: string; email?: string }) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.myBands.inviteToBand({ params: { bandId }, payload: data }),
        ),
      ),
    ),
}

// --- Songs ---

export const songs = {
  byBand: (bandId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.songs.songFindByBandId({ params: { bandId } })))),

  byId: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.songs.songFindById({ params: { id } })))),

  create: (data: SongCreateData) =>
    run(api.pipe(Effect.flatMap((c) => c.songs.songCreate({ payload: data })))),

  update: (id: string, data: SongUpdateData) =>
    run(
      api.pipe(Effect.flatMap((c) => c.songs.songUpdate({ params: { id }, payload: data }))),
    ),

  remove: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.songs.songDelete({ params: { id } })))),
}

// --- Charts ---

export const charts = {
  bySong: (songId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.charts.listCharts({ params: { songId } })))),

  createLyrics: (data: LyricsChartCreateData) =>
    run(api.pipe(Effect.flatMap((c) => c.charts.createLyricsChart({ payload: data })))),

  /** The chords and lyrics of a PDF or image, as text for the paste box. Nothing is stored. */
  readFile: (bytes: Uint8Array) =>
    run(api.pipe(Effect.flatMap((c) => c.charts.readChartFile({ payload: bytes })))),

  saveRevision: (id: string, data: ChartRevisionData) =>
    run(api.pipe(Effect.flatMap((c) => c.charts.saveRevision({ params: { id }, payload: data })))),

  remove: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.charts.deleteChart({ params: { id } })))),
}

// --- Marks and stamps ---

export const marks = {
  byChart: (chartId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.marks.listMarks({ params: { chartId } })))),

  create: (data: MarkData) =>
    run(api.pipe(Effect.flatMap((c) => c.marks.createMark({ payload: data })))),

  update: (id: string, data: MarkData) =>
    run(api.pipe(Effect.flatMap((c) => c.marks.updateMark({ params: { id }, payload: data })))),

  remove: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.marks.deleteMark({ params: { id } })))),
}

export const stamps = {
  list: () => run(api.pipe(Effect.flatMap((c) => c.stamps.listStamps({})))),

  create: (data: StampData) =>
    run(api.pipe(Effect.flatMap((c) => c.stamps.createStamp({ payload: data })))),

  remove: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.stamps.deleteStamp({ params: { id } })))),
}

// --- Scores ---

export const scores = {
  /** Uploads a Guitar Pro file as a new score chart; the server stores the bytes unchanged. */
  upload: (data: { song_id: string; name: string; file_name: string; bytes: Uint8Array }) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.scores.uploadScore({
            query: { song_id: data.song_id, name: data.name, file_name: data.file_name },
            payload: data.bytes,
          }),
        ),
      ),
    ),

  /** The uploaded file of a score revision, exactly as stored. */
  file: (revisionId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.scores.scoreFile({ params: { revisionId } })))),
}

// --- Setlists ---

export const setlists = {
  byBand: (bandId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.listSetlists({ params: { bandId } })))),

  get: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.getSetlist({ params: { id } })))),

  create: (data: SetlistCreateData) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.createSetlist({ payload: data })))),

  update: (id: string, data: SetlistUpdateData) =>
    run(
      api.pipe(Effect.flatMap((c) => c.setlists.updateSetlist({ params: { id }, payload: data }))),
    ),

  remove: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.deleteSetlist({ params: { id } })))),

  entries: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.listEntries({ params: { id } })))),

  addEntry: (id: string, data: SetlistEntryCreateData) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.addEntry({ params: { id }, payload: data })))),

  updateEntry: (id: string, entryId: string, data: SetlistEntryUpdateData) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.setlists.updateEntry({ params: { id, entryId }, payload: data }),
        ),
      ),
    ),

  removeEntry: (id: string, entryId: string) =>
    run(
      api.pipe(Effect.flatMap((c) => c.setlists.deleteEntry({ params: { id, entryId } }))),
    ),

  sections: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.listSections({ params: { id } })))),

  addSection: (id: string, name: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.addSection({ params: { id }, payload: { name } })))),

  renameSection: (id: string, sectionId: string, name: string) =>
    run(
      api.pipe(
        Effect.flatMap((c) => c.setlists.renameSection({ params: { id, sectionId }, payload: { name } })),
      ),
    ),

  removeSection: (id: string, sectionId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.deleteSection({ params: { id, sectionId } })))),

  /** Tells the others watching the setlist what this connection is doing; see `useSetlistLive`. */
  reportPresence: (id: string, data: SetlistPresenceData) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.reportPresence({ params: { id }, payload: data })))),

  /** Stores the whole play order; see `SetlistArrangement`. */
  arrange: (id: string, arrangement: SetlistArrangementData) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.arrange({ params: { id }, payload: arrangement })))),
}
