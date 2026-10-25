import { Effect, ManagedRuntime, Schema as S } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import {
  GigListApi,
  AuthUser as AuthUserSchema,
  UserEmail as UserEmailSchema,
  BandInfo as BandInfoSchema,
  BandMember as BandMemberSchema,
  BandInvitation as BandInvitationSchema,
  PendingInvitation as PendingInvitationSchema,
  PublicBandProfile as PublicBandProfileSchema,
  PublicUserProfile as PublicUserProfileSchema,
  PageTheme as PageThemeSchema,
  Setlist as SetlistSchema,
  SetlistEntry as SetlistEntrySchema,
  Gig as GigSchema,
  GigEntry as GigEntrySchema,
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
export type UserEmailInfo = S.Schema.Type<typeof UserEmailSchema>
export type BandInfo = S.Schema.Type<typeof BandInfoSchema>
export type BandMember = S.Schema.Type<typeof BandMemberSchema>
export type BandInvitationInfo = S.Schema.Type<typeof BandInvitationSchema>
export type PendingInvitationInfo = S.Schema.Type<typeof PendingInvitationSchema>
export type PublicBandProfileInfo = S.Schema.Type<typeof PublicBandProfileSchema>
export type PublicUserProfileInfo = S.Schema.Type<typeof PublicUserProfileSchema>
export type PageTheme = S.Schema.Type<typeof PageThemeSchema>
export type SetlistInfo = S.Schema.Type<typeof SetlistSchema>
export type SetlistEntryInfo = S.Schema.Type<typeof SetlistEntrySchema>
export type GigInfo = S.Schema.Type<typeof GigSchema>
export type GigEntryInfo = S.Schema.Type<typeof GigEntrySchema>

/** The payloads each endpoint declares, taken from the contract so the client
 *  never restates the shape the server validates. */
type SongsClient = Effect.Success<GigListApiClient>["songs"]
export type SongCreateData = Parameters<SongsClient["songCreate"]>[0]["payload"]
export type SongUpdateData = Parameters<SongsClient["songUpdate"]>[0]["payload"]

type MyBandsClient = Effect.Success<GigListApiClient>["myBands"]
export type BandUpdateData = Parameters<MyBandsClient["updateBand"]>[0]["payload"]

type ChartsClient = Effect.Success<GigListApiClient>["charts"]
export type LyricsChartCreateData = Parameters<ChartsClient["createLyricsChart"]>[0]["payload"]
export type ChartRevisionData = Parameters<ChartsClient["saveRevision"]>[0]["payload"]

type MarksClient = Effect.Success<GigListApiClient>["marks"]
export type MarkData = Parameters<MarksClient["createMark"]>[0]["payload"]
type StampsClient = Effect.Success<GigListApiClient>["stamps"]
export type StampData = Parameters<StampsClient["createStamp"]>[0]["payload"]

type SetlistsClient = Effect.Success<GigListApiClient>["setlists"]
export type SetlistCreateData = Parameters<SetlistsClient["createSetlist"]>[0]["payload"]
export type SetlistUpdateData = Parameters<SetlistsClient["updateSetlist"]>[0]["payload"]
export type SetlistEntryCreateData = Parameters<SetlistsClient["addEntry"]>[0]["payload"]
export type SetlistEntryUpdateData = Parameters<SetlistsClient["updateEntry"]>[0]["payload"]
export type MoveData = Parameters<SetlistsClient["move"]>[0]["payload"]
export type PresenceData = Parameters<SetlistsClient["reportPresence"]>[0]["payload"]

type GigsClient = Effect.Success<GigListApiClient>["gigs"]
export type GigCreateData = Parameters<GigsClient["createGig"]>[0]["payload"]
export type GigDetailsData = Parameters<GigsClient["updateGig"]>[0]["payload"]

/** The auth payloads, likewise taken from the contract. The password is a
 *  `Redacted` here, so the browser form builds one before it calls the API. */
type AuthClient = Effect.Success<GigListApiClient>["auth"]
export type LoginData = Parameters<AuthClient["login"]>[0]["payload"]
export type RegisterData = Parameters<AuthClient["register"]>[0]["payload"]
export type ForgotPasswordData = Parameters<AuthClient["forgotPassword"]>[0]["payload"]
export type ResetPasswordData = Parameters<AuthClient["resetPassword"]>[0]["payload"]
export type UpdateProfileData = Parameters<AuthClient["updateMe"]>[0]["payload"]
export type ChangePasswordData = Parameters<AuthClient["changePassword"]>[0]["payload"]
export type AddEmailData = Parameters<AuthClient["addEmail"]>[0]["payload"]

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

const api = HttpApiClient.make(GigListApi, { baseUrl: window.location.origin })
type GigListApiClient = typeof api

// --- Auth ---

export const auth = {
  me: () => run(api.pipe(Effect.flatMap((c) => c.auth.me({})))),

  login: (data: LoginData) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.login({ payload: data })))),

  register: (data: RegisterData) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.register({ payload: data })))),

  forgotPassword: (data: ForgotPasswordData) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.forgotPassword({ payload: data })))),

  resetPassword: (data: ResetPasswordData) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.resetPassword({ payload: data })))),

  logout: () => run(api.pipe(Effect.flatMap((c) => c.auth.logout({})))),

  updateMe: (data: UpdateProfileData) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.updateMe({ payload: data })))),

  changePassword: (data: ChangePasswordData) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.changePassword({ payload: data })))),

  listEmails: () => run(api.pipe(Effect.flatMap((c) => c.auth.listEmails({})))),

  addEmail: (data: AddEmailData) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.addEmail({ payload: data })))),

  removeEmail: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.removeEmail({ params: { id } })))),

  makeEmailPrimary: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.makeEmailPrimary({ params: { id } })))),

  resendEmailVerification: (id: string) =>
    run(
      api.pipe(Effect.flatMap((c) => c.auth.resendEmailVerification({ params: { id } }))),
    ),

  verifyEmail: (data: { id: string; token: string }) =>
    run(api.pipe(Effect.flatMap((c) => c.auth.verifyEmail({ payload: data })))),

  requestAccountDeletion: () =>
    run(api.pipe(Effect.flatMap((c) => c.auth.requestAccountDeletion({})))),

  confirmAccountDeletion: (token: string) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.auth.confirmAccountDeletion({ payload: { token } }),
        ),
      ),
    ),
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

  update: (bandId: string, data: BandUpdateData) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.myBands.updateBand({ params: { bandId }, payload: data }),
        ),
      ),
    ),

  /** A band's public page, or null when no band has that slug. */
  publicProfile: (slug: string) =>
    run(
      api.pipe(
        Effect.flatMap((c) => c.publicBands.getPublicBand({ params: { slug } })),
        Effect.catchTag("PublicBandNotFound", () => Effect.succeed(null)),
      ),
    ),

  leave: (bandId: string, data: { transfer_to?: string } = {}) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.myBands.leaveBand({ params: { bandId }, payload: data }),
        ),
      ),
    ),

  transferOwnership: (bandId: string, userId: string) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.myBands.transferOwnership({
            params: { bandId },
            payload: { user_id: userId },
          }),
        ),
      ),
    ),

  removeMember: (bandId: string, userId: string) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.myBands.removeMember({ params: { bandId, userId } }),
        ),
      ),
    ),

  invitations: () => run(api.pipe(Effect.flatMap((c) => c.myBands.listInvitations({})))),

  acceptInvitation: (invitationId: string, code: string | null) =>
    run(
      api.pipe(
        Effect.flatMap((c) => c.myBands.acceptInvitation({ params: { invitationId }, payload: { code } })),
      ),
    ),

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

  pendingInvitations: (bandId: string) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.myBands.listPendingInvitations({ params: { bandId } }),
        ),
      ),
    ),

  cancelInvitation: (bandId: string, invitationId: string) =>
    run(
      api.pipe(
        Effect.flatMap((c) =>
          c.myBands.cancelInvitation({ params: { bandId, invitationId } }),
        ),
      ),
    ),
}

// --- Public user profiles ---

export const users = {
  /** A user's public profile, or null when no user has that name or the profile is off. */
  publicProfile: (username: string) =>
    run(
      api.pipe(
        Effect.flatMap((c) => c.publicUsers.getPublicUser({ params: { username } })),
        Effect.catchTag("PublicUserNotFound", () => Effect.succeed(null)),
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
    run(api.pipe(Effect.flatMap((c) => c.setlists.updateSetlist({ params: { id }, payload: data })))),

  /** A new setlist with the same songs and overrides, in no gig yet. */
  copy: (id: string, name: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.copySetlist({ params: { id }, payload: { name } })))),

  remove: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.deleteSetlist({ params: { id } })))),

  entries: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.listEntries({ params: { id } })))),

  addEntry: (id: string, data: SetlistEntryCreateData) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.addEntry({ params: { id }, payload: data })))),

  /** Changes only the fields in `data`; a null override inherits the song's value. */
  updateEntry: (id: string, entryId: string, data: SetlistEntryUpdateData) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.updateEntry({ params: { id, entryId }, payload: data })))),

  removeEntry: (id: string, entryId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.deleteEntry({ params: { id, entryId } })))),

  /** Tells the others watching the setlist what this connection is doing; see `useLive`. */
  reportPresence: (id: string, data: PresenceData) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.reportPresence({ params: { id }, payload: data })))),

  /** Moves one entry right after `previous`; the server computes its key. */
  move: (id: string, move: MoveData) =>
    run(api.pipe(Effect.flatMap((c) => c.setlists.move({ params: { id }, payload: move })))),
}

// --- Gigs ---

export const gigs = {
  byBand: (bandId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.listGigs({ params: { bandId } })))),

  get: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.getGig({ params: { id } })))),

  create: (data: GigCreateData) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.createGig({ payload: data })))),

  update: (id: string, data: GigDetailsData) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.updateGig({ params: { id }, payload: data })))),

  remove: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.deleteGig({ params: { id } })))),

  /** The gig plays `setlistId` after the setlists it already plays. */
  addSetlist: (id: string, setlistId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.addGigSetlist({ params: { id }, payload: { setlist_id: setlistId } })))),

  /** The gig stops playing `setlistId`; the setlist itself stays. */
  removeSetlist: (id: string, setlistId: string) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.removeGigSetlist({ params: { id, setlistId } })))),

  /** The gig plays a new copy of `setlistId`, named `name`, in its place; other gigs keep the original. */
  copySetlist: (id: string, setlistId: string, name: string) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.copyGigSetlist({ params: { id, setlistId }, payload: { name } })))),

  /** Moves one setlist right after `previous` in the gig's order. */
  moveSetlist: (id: string, move: MoveData) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.moveGigSetlist({ params: { id }, payload: move })))),

  /** Every song the gig plays, in order, each with its setlist's name. */
  entries: (id: string) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.listGigEntries({ params: { id } })))),

  /** Tells the others watching the gig what this connection is doing; see `useLive`. */
  reportPresence: (id: string, data: PresenceData) =>
    run(api.pipe(Effect.flatMap((c) => c.gigs.reportGigPresence({ params: { id }, payload: data })))),
}
