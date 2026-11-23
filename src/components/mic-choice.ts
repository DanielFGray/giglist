import { useSyncExternalStore } from "react"

/**
 * The microphone the player chose for the click's Listen and for recording a
 * take, or null for the browser's default. A microphone belongs to a device, so
 * the choice is kept in this browser, not on the account. Every component that
 * reads it follows a change made in another one, and in another tab.
 */
export function useMicChoice(): readonly [string | null, (micId: string | null) => void] {
  const micId = useSyncExternalStore(subscribe, read, () => null)
  return [micId, write] as const
}

const KEY = "setlist:mic"
const listeners = new Set<() => void>()
/** The choice when storage refuses it (private windows, blocked site data): it then lasts until the page reloads. */
let unstored: string | null = null

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return unstored
  }
}

function write(micId: string | null) {
  unstored = micId
  try {
    if (micId === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, micId)
  } catch {
    // `unstored` holds it instead.
  }
  for (const listener of listeners) listener()
}
