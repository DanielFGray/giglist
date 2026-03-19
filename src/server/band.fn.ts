import { createServerFn } from "@tanstack/react-start"
import { runtime } from "./runtime"
import * as Band from "./services/band"
import { getSessionId } from "./session"

export type BandInfo = {
  id: string
  slug: string
  name: string
  description: string | null
  created_at: string
}

export type BandMember = {
  id: string
  user_id: string
  is_owner: boolean
  created_at: string
  username: string
  name: string | null
  avatar_url: string | null
}

type BandResult<T> = { ok: true; data: T } | { ok: false; error: string }

export const getUserBandsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<BandInfo[]> => {
    const sessionId = getSessionId()
    if (!sessionId) return []

    const bands = await runtime
      .runPromise(Band.getUserBands(sessionId))
      .catch(() => [])

    return bands.map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      description: b.description ?? null,
      created_at: String(b.created_at),
    }))
  },
)

export const getBandMembersFn = createServerFn({ method: "GET" })
  .inputValidator((data: { bandId: string }) => data)
  .handler(async ({ data }): Promise<BandMember[]> => {
    const sessionId = getSessionId()
    if (!sessionId) return []

    const members = await runtime
      .runPromise(Band.getBandMembers(sessionId, data.bandId))
      .catch(() => [])

    return members.map((m) => ({
      id: m.id,
      user_id: m.user_id,
      is_owner: m.is_owner,
      created_at: String(m.created_at),
      username: m.username,
      name: m.name ?? null,
      avatar_url: m.avatar_url ?? null,
    }))
  })

export const createBandFn = createServerFn({ method: "POST" })
  .inputValidator((data: { slug: string; name: string }) => data)
  .handler(async ({ data }): Promise<BandResult<BandInfo>> => {
    const sessionId = getSessionId()
    if (!sessionId) return { ok: false, error: "Not authenticated" }

    const result = await runtime
      .runPromise(Band.createBand(sessionId, data))
      .catch((e) => ({ error: e?.message ?? "Failed to create band" }) as const)

    if ("error" in result) return { ok: false, error: result.error }

    return {
      ok: true,
      data: {
        id: result.id,
        slug: result.slug,
        name: result.name,
        description: null,
        created_at: new Date().toISOString(),
      },
    }
  })

export const inviteToBandFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { bandId: string; username?: string; email?: string }) => data,
  )
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const sessionId = getSessionId()
    if (!sessionId) return { ok: false, error: "Not authenticated" }

    const result = await runtime
      .runPromise(Band.inviteToBand(sessionId, data))
      .catch((e) => ({ error: e?.message ?? "Failed to invite" }) as const)

    if (result && "error" in result) return { ok: false, error: result.error }
    return { ok: true }
  })

export const deleteBandFn = createServerFn({ method: "POST" })
  .inputValidator((data: { bandId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const sessionId = getSessionId()
    if (!sessionId) return { ok: false, error: "Not authenticated" }

    await runtime
      .runPromise(Band.deleteBand(sessionId, data.bandId))
      .catch(() => {})
    return { ok: true }
  })
