import { Context } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"

// --- Security ---

export const sessionCookie = HttpApiSecurity.apiKey({
  key: "session",
  in: "cookie",
})

// --- Session context (server provides, client strips) ---

export interface SessionData {
  readonly sessionId: string
  readonly userId: string | null
}

export class CurrentSession extends Context.Service<CurrentSession, SessionData>()("CurrentSession") {}

export class SessionMiddleware extends HttpApiMiddleware.Service<
  SessionMiddleware,
  { provides: CurrentSession }
>()("SessionMiddleware", {
  security: { session: sessionCookie },
}) {}
