import { useEffect, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { auth } from "~/api/client"
import { errorMessage } from "~/components/form"

export const Route = createFileRoute("/verify-email")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === "string" ? search.id : "",
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { id, token } = Route.useSearch()
  const [status, setStatus] = useState<"pending" | "ok" | "error">("pending")
  const [message, setMessage] = useState("Verifying your email…")

  useEffect(() => {
    if (!id || !token) {
      setStatus("error")
      setMessage("This verification link is missing its id or token.")
      return
    }
    let cancelled = false
    void auth
      .verifyEmail({ id, token })
      .then(() => {
        if (cancelled) return
        setStatus("ok")
        setMessage("Email verified.")
      })
      .catch((e) => {
        if (cancelled) return
        setStatus("error")
        setMessage(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [id, token])

  return (
    <div
      data-pwid="verify-email-page"
      className="min-h-[60vh] flex items-center justify-center"
    >
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Verify email</h1>
        <p
          data-pwid={
            status === "ok"
              ? "verify-email-ok"
              : status === "error"
                ? "verify-email-error"
                : "verify-email-pending"
          }
          className={`text-sm ${status === "error" ? "text-red-400" : "text-zinc-400"}`}
        >
          {message}
        </p>
        {status !== "pending" && (
          <Link
            data-pwid="verify-email-to-settings"
            to="/settings"
            className="inline-block text-sm text-[var(--color-amber-accent)] hover:underline"
          >
            Back to settings
          </Link>
        )}
      </div>
    </div>
  )
}
