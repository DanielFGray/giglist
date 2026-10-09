import { Effect, ManagedRuntime, Schema as S } from "effect"
import { FetchHttpClient, HttpApiClient, HttpClient } from "@effect/platform"
import { SetListApi } from "./contracts"

// --- Types derived from contract schemas ---

export type AuthUser = S.Schema.Type<typeof import("./contracts").AuthUser>
export type BandInfo = S.Schema.Type<typeof import("./contracts").BandInfo>
export type BandMember = S.Schema.Type<typeof import("./contracts").BandMember>

// --- Client runtime ---

const runtime = ManagedRuntime.make(FetchHttpClient.layer)

// --- Result type for mutations ---

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** Extract a human-readable message from any error */
const errorMsg = (e: unknown, fallback: string): string => {
  if (e && typeof e === "object" && "message" in e) return String(e.message)
  return fallback
}

/** Run an effect, provide HttpClient, return Result */
const runSafe = <A>(
  effect: Effect.Effect<A, unknown, HttpClient.HttpClient>,
  fallback: string,
): Promise<Result<A>> =>
  runtime.runPromise(
    effect.pipe(
      Effect.map((value): Result<A> => ({ ok: true, value })),
      Effect.catchAll((e) =>
        Effect.succeed<Result<A>>({ ok: false, error: errorMsg(e, fallback) }),
      ),
    ),
  )

/** Run a query effect, provide HttpClient, return value or fallback */
const run = <A>(
  effect: Effect.Effect<A, unknown, HttpClient.HttpClient>,
  fallback: A,
): Promise<A> =>
  runtime.runPromise(
    effect.pipe(Effect.catchAll(() => Effect.succeed(fallback))),
  )

// --- Typed API client (one client for the unified API) ---

const api = HttpApiClient.make(SetListApi, { baseUrl: window.location.origin })

// --- Auth ---

export const auth = {
  me: () =>
    run(
      api.pipe(Effect.flatMap((c) => c.auth.me({}))),
      null,
    ),

  login: (data: { id: string; password: string }) =>
    runSafe(
      api.pipe(Effect.flatMap((c) => c.auth.login({ payload: data }))),
      "Login failed",
    ),

  register: (data: { username: string; email: string; password: string }) =>
    runSafe(
      api.pipe(Effect.flatMap((c) => c.auth.register({ payload: data }))),
      "Registration failed",
    ),

  logout: () =>
    run(
      api.pipe(Effect.flatMap((c) => c.auth.logout({}))),
      { ok: true as const },
    ),
}

// --- Bands ---

export const bands = {
  list: () =>
    run(
      api.pipe(Effect.flatMap((c) => c.myBands.listBands({}))),
      [] as readonly BandInfo[],
    ),

  members: (bandId: string) =>
    run(
      api.pipe(Effect.flatMap((c) => c.myBands.getBandMembers({ path: { bandId } }))),
      [] as readonly BandMember[],
    ),

  create: (data: { slug: string; name: string }) =>
    runSafe(
      api.pipe(Effect.flatMap((c) => c.myBands.createBand({ payload: data }))),
      "Failed to create band",
    ),

  delete: (bandId: string) =>
    runSafe(
      api.pipe(Effect.flatMap((c) => c.myBands.deleteBand({ path: { bandId } }))),
      "Failed to delete band",
    ),

  invite: (bandId: string, data: { username?: string; email?: string }) =>
    runSafe(
      api.pipe(Effect.flatMap((c) => c.myBands.inviteToBand({ path: { bandId }, payload: data }))),
      "Failed to invite",
    ),
}
