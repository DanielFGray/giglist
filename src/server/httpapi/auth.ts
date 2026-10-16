import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
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
    .handle("login", Effect.fnUntraced(function*({ payload }) {
        const result = yield* Auth.login(payload)
        yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, {
          httpOnly: true,
          sameSite: "lax",
          secure: isSecure,
          path: "/",
          maxAge: "30 days",
        })
        return { ok: true as const }
      },
        Effect.mapError((e) => new AuthError({ message: e.message })),
      ),
    )
    .handle("register", Effect.fnUntraced(function*({ payload }) {
        const result = yield* Auth.register(payload)
        yield* HttpApiBuilder.securitySetCookie(sessionCookie, result.sessionId, {
          httpOnly: true,
          sameSite: "lax",
          secure: isSecure,
          path: "/",
          maxAge: "30 days",
        })
        return { ok: true as const }
      },
        Effect.mapError((e) => new AuthError({ message: e.message })),
      ),
    )
    .handle("logout", Effect.fnUntraced(function*() {
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
    .handle("me", Effect.fnUntraced(function*() {
        const session = yield* CurrentSession
        if (!session.sessionId || !session.userId) return null
        return yield* Auth.getMe(session.sessionId).pipe(
          Effect.orElseSucceed(() => null),
        )
      }),
    ),
)
