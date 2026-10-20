import { useEffect, useRef, useState } from "react"
import { Schema as S } from "effect"
import { gigs, setlists } from "~/api/client"
import { LiveEvent, type LiveViewer } from "~/api/contracts"

export type Viewer = S.Schema.Type<typeof LiveViewer>

/** What a page keeps in step with: a setlist, or a gig (which hears the writes to every setlist it plays). */
export type Room = { readonly kind: "setlist" | "gig"; readonly id: string }

const decodeEvent = S.decodeUnknownSync(S.fromJsonString(LiveEvent))

const ROOM_API = { setlist: { path: "setlists", client: setlists }, gig: { path: "gigs", client: gigs } } as const

/** The server pings every 20 seconds; this much quiet means the connection is dead. */
const SILENCE_MS = 45_000
/** How long to wait before opening a stream the browser gave up on. */
const RETRY_MS = 2000

/**
 * Keeps a page in step with one setlist or gig.
 *
 * It opens the room's event stream and gives back who else has it open.
 * `onChanged` runs when someone writes it (with their name), and with
 * `null` each time the stream opens, because writes made while it was down were
 * never announced. `status` is what this page is doing, shown to the others.
 */
export function useLive(
  room: Room,
  status: { mode: Viewer["mode"]; at: number | null },
  onChanged: (by: string | null) => void,
): { client: string; viewers: ReadonlyArray<Viewer> } {
  const [client] = useState(newClientId)
  const [viewers, setViewers] = useState<ReadonlyArray<Viewer>>([])
  const [joined, setJoined] = useState(false)
  const handler = useRef(onChanged)
  handler.current = onChanged

  useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let lastHeard = Date.now()
    const open = () => {
      clearTimeout(retry)
      source?.close()
      const stream = new EventSource(`/api/${ROOM_API[room.kind].path}/${room.id}/events?client=${client}`)
      // Whatever was written before the stream opened was never announced, so every open reloads.
      stream.onopen = () => handler.current(null)
      stream.onmessage = (message) => {
        lastHeard = Date.now()
        let event: S.Schema.Type<typeof LiveEvent>
        try {
          event = decodeEvent(message.data)
        } catch {
          return
        }
        if (event.kind === "changed") handler.current(event.by)
        else if (event.kind === "presence") {
          setViewers(event.viewers)
          setJoined(true)
        }
      }
      // A dropped stream is retried by the browser, but one that failed to reconnect is closed for good, so retry it here.
      stream.onerror = () => {
        setJoined(false)
        if (stream.readyState === EventSource.CLOSED) retry = setTimeout(open, RETRY_MS)
      }
      source = stream
    }
    open()
    window.addEventListener("online", open)
    // A connection that went silent without an error (a dropped network, a proxy) is replaced.
    const watchdog = setInterval(() => {
      if (Date.now() - lastHeard < SILENCE_MS) return
      lastHeard = Date.now()
      setJoined(false)
      open()
    }, 5000)
    return () => {
      clearInterval(watchdog)
      clearTimeout(retry)
      window.removeEventListener("online", open)
      source?.close()
      setViewers([])
      setJoined(false)
    }
  }, [room.kind, room.id, client])

  // The server lists a connection as "viewing" when it opens, so a page tells it what it is doing once it is listed.
  useEffect(() => {
    if (!joined) return
    ROOM_API[room.kind].client.reportPresence(room.id, { client, mode: status.mode, at: status.at }).catch(() => undefined)
  }, [joined, room.kind, room.id, client, status.mode, status.at])

  return { client, viewers }
}

/** A random id for this page's connection; `crypto.randomUUID` is missing outside secure contexts. */
function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
