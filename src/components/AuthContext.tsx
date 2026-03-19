import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react"
import type { AuthUser } from "~/server/auth.fn"
import type { BandInfo } from "~/server/band.fn"

type AuthContextValue = {
  user: AuthUser | null
  bands: BandInfo[]
  currentBand: BandInfo | null
  setCurrentBandId: (id: string) => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  bands: [],
  currentBand: null,
  setCurrentBandId: () => {},
})

export function AuthProvider({
  user,
  bands,
  children,
}: {
  user: AuthUser | null
  bands: BandInfo[]
  children: ReactNode
}) {
  const [currentBandId, setCurrentBandId] = useState<string | null>(() => {
    if (typeof window === "undefined") return bands[0]?.id ?? null
    const stored = localStorage.getItem("setlist-current-band")
    if (stored && bands.some((b) => b.id === stored)) return stored
    return bands[0]?.id ?? null
  })

  const currentBand = bands.find((b) => b.id === currentBandId) ?? null

  const setBandId = (id: string) => {
    setCurrentBandId(id)
    if (typeof window !== "undefined") {
      localStorage.setItem("setlist-current-band", id)
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, bands, currentBand, setCurrentBandId: setBandId }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
