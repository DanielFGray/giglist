import {
  getCookie,
  setCookie,
} from "@tanstack/react-start/server"

const COOKIE_NAME = "session"
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

export function getSessionId(): string | undefined {
  return getCookie(COOKIE_NAME) || undefined
}

export function setSessionCookie(sessionId: string) {
  setCookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie() {
  setCookie(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
}
