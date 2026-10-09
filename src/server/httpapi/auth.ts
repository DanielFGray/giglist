import { Effect } from "effect"
import { HttpApiBuilder } from "@effect/platform"
import * as Auth from "../services/auth"
import {
  SetListApi,
  AuthError,
  CurrentSession,
  sessionCookie,
} from "../../api/contracts"

const isSecure = process.env.NODE_ENV === "production"

export const authHandlers = HttpApiBuilder.group(SetListApi, "auth", (handlers) =>
  handlers
    .handle("login", ({ payload }) =>
      Effect.gen(function* () {
        const result = yield* Auth.login(payload)
        yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, {
          httpOnly: true,
          sameSite: "lax",
          secure: isSecure,
          path: "/",
          maxAge: "30 days",
        })
        return { ok: true as const }
      }).pipe(
        Effect.catchAll((e) =>
          Effect.fail(new AuthError({ message: "message" in e ? String(e.message) : "Login failed" })),
        ),
      ),
    )
    .handle("register", ({ payload }) =>
      Effect.gen(function* () {
        const result = yield* Auth.register(payload)
        yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, {
          httpOnly: true,
          sameSite: "lax",
          secure: isSecure,
          path: "/",
          maxAge: "30 days",
        })
        return { ok: true as const }
      }).pipe(
        Effect.catchAll((e) =>
          Effect.fail(new AuthError({ message: "message" in e ? String(e.message) : "Registration failed" })),
        ),
      ),
    )
    .handle("logout", () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        if (session.sessionId) {
          yield* Auth.logout(session.sessionId).pipe(Effect.orDie)
        }
        yield* HttpApiBuilder.securitySetCookie(sessionCookie, "", {
          httpOnly: true,
          sameSite: "lax",
          secure: isSecure,
          path: "/",
          maxAge: "0 seconds",
        })
        return { ok: true as const }
      }),
    )
    .handle("me", () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession
        if (!session.sessionId || !session.userId) return null
        return yield* Auth.getMe(session.sessionId).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        )
      }),
    ),
)
