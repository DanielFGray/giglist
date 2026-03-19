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

export const getUserBandsFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const sessionId = getSessionId()
    if (!sessionId) return { bands: [] as BandInfo[] }

    try {
      const rows = await runtime.runPromise(Band.getUserBands(sessionId))
      const bands: BandInfo[] = []
      for (const b of rows) {
        bands.push({
          id: String(b.id),
          slug: String(b.slug),
          name: String(b.name),
          description: b.description != null ? String(b.description) : null,
          created_at: String(b.created_at),
        })
      }
      return { bands }
    } catch {
      return { bands: [] as BandInfo[] }
    }
  },
)

export const getBandMembersFn = createServerFn({ method: "GET" })
  .inputValidator((data: { bandId: string }) => data)
  .handler(async ({ data }) => {
    const sessionId = getSessionId()
    if (!sessionId) return { members: [] as BandMember[] }

    try {
      const rows = await runtime.runPromise(Band.getBandMembers(sessionId, data.bandId))
      const members: BandMember[] = []
      for (const m of rows) {
        members.push({
          id: String(m.id),
          user_id: String(m.user_id),
          is_owner: Boolean(m.is_owner),
          created_at: String(m.created_at),
          username: String(m.username),
          name: m.name != null ? String(m.name) : null,
          avatar_url: m.avatar_url != null ? String(m.avatar_url) : null,
        })
      }
      return { members }
    } catch {
      return { members: [] as BandMember[] }
    }
  })

export const createBandFn = createServerFn({ method: "POST" })
  .inputValidator((data: { slug: string; name: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const sessionId = getSessionId()
    if (!sessionId) return { ok: false, error: "Not authenticated" }

    try {
      await runtime.runPromise(Band.createBand(sessionId, data))
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Failed to create band" }
    }
  })

export const inviteToBandFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { bandId: string; username?: string; email?: string }) => data,
  )
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const sessionId = getSessionId()
    if (!sessionId) return { ok: false, error: "Not authenticated" }

    try {
      await runtime.runPromise(Band.inviteToBand(sessionId, data))
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Failed to invite" }
    }
  })

export const deleteBandFn = createServerFn({ method: "POST" })
  .inputValidator((data: { bandId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const sessionId = getSessionId()
    if (!sessionId) return { ok: false, error: "Not authenticated" }

    try {
      await runtime.runPromise(Band.deleteBand(sessionId, data.bandId))
      return { ok: true }
    } catch {
      return { ok: false, error: "Failed to delete band" }
    }
  })
