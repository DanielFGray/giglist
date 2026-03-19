import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { runtime } from "./runtime"
import * as Auth from "./services/auth"
import { getSessionId, setSessionCookie, clearSessionCookie } from "./session"

export type AuthUser = {
  id: string
  username: string
  name: string | null
  avatar_url: string | null
  role: string
  is_verified: boolean
}

type AuthResult = { ok: true } | { ok: false; error: string }

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; password: string }) => data,
  )
  .handler(async ({ data }): Promise<AuthResult> => {
    const result = await runtime.runPromise(Auth.login(data)).catch((e) => {
      return { error: e?.message ?? "Login failed" } as const
    })

    if ("error" in result) return { ok: false, error: result.error }

    setSessionCookie(result.sessionId)
    return { ok: true }
  })

export const registerFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { username: string; email: string; password: string }) => data,
  )
  .handler(async ({ data }): Promise<AuthResult> => {
    const result = await runtime.runPromise(Auth.register(data)).catch((e) => {
      return { error: e?.message ?? "Registration failed" } as const
    })

    if ("error" in result) return { ok: false, error: result.error }

    setSessionCookie(result.sessionId)
    return { ok: true }
  })

export const logoutFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const sessionId = getSessionId()
    if (sessionId) {
      await runtime.runPromise(Auth.logout(sessionId)).catch(() => {})
    }
    clearSessionCookie()
    return { ok: true as const }
  },
)

export const getMeFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthUser | null> => {
    const sessionId = getSessionId()
    if (!sessionId) return null

    const user = await runtime
      .runPromise(Auth.getMe(sessionId))
      .catch(() => null)

    if (!user) return null

    // Return a plain object — Kysely results may have non-serializable prototypes
    return {
      id: user.id,
      username: user.username,
      name: user.name ?? null,
      avatar_url: user.avatar_url ?? null,
      role: user.role,
      is_verified: user.is_verified,
    }
  },
)
