import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type { AuthUser, BandInfo } from "~/api/client"

type AuthContextValue = {
  user: AuthUser | null
  bands: readonly BandInfo[]
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
  bands: readonly BandInfo[]
  children: ReactNode
}) {
  const [currentBandId, setCurrentBandId] = useState<string | null>(bands[0]?.id ?? null)

  useEffect(() => {
    const stored = localStorage.getItem("setlist-current-band")
    if (stored && bands.some((b) => b.id === stored)) {
      setCurrentBandId(stored)
    } else if (bands.length > 0 && !bands.some((b) => b.id === currentBandId)) {
      setCurrentBandId(bands[0].id)
    }
  }, [bands])

  const currentBand = bands.find((b) => b.id === currentBandId) ?? null

  const setBandId = (id: string) => {
    setCurrentBandId(id)
    localStorage.setItem("setlist-current-band", id)
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
