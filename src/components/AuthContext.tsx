import { createContext, useContext, type ReactNode } from "react"
import { useRouterState } from "@tanstack/react-router"
import type { AuthUser, BandInfo } from "~/api/client"

type AuthContextValue = {
  user: AuthUser | null
  bands: readonly BandInfo[]
}

const AuthContext = createContext<AuthContextValue>({ user: null, bands: [] })

export function AuthProvider({
  user,
  bands,
  children,
}: {
  user: AuthUser | null
  bands: readonly BandInfo[]
  children: ReactNode
}) {
  return (
    <AuthContext.Provider value={{ user, bands }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

/**
 * The band the current route is scoped to, falling back to the user's first
 * band as the default target for nav links. The URL is the only place the
 * selection lives while a band's page is open.
 *
 * The contract guarantees a band id is a UUID, so the id is the path segment
 * after `/band/` when it is one; `/band/new` matches nothing.
 */
const BAND_IN_PATH =
  /^\/band\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

export function useActiveBandId(): string | null {
  const { bands } = useAuth()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return BAND_IN_PATH.exec(pathname)?.[1] ?? bands[0]?.id ?? null
}
