import {
  createContext,
  useContext,
  type ReactNode,
} from "react"
import type { AuthUser } from "~/server/auth.fn"

type AuthContextValue = {
  user: AuthUser | null
}

const AuthContext = createContext<AuthContextValue>({ user: null })

export function AuthProvider({
  user,
  children,
}: {
  user: AuthUser | null
  children: ReactNode
}) {
  return (
    <AuthContext.Provider value={{ user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
