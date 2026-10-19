import { useEffect, useState } from "react"
import { Link, createFileRoute, useRouter } from "@tanstack/react-router"
import { auth } from "~/api/client"
import { errorMessage } from "~/components/form"

export const Route = createFileRoute("/delete-account")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: DeleteAccountPage,
})

function DeleteAccountPage() {
  const { token } = Route.useSearch()
  const router = useRouter()
  const [status, setStatus] = useState<"pending" | "ok" | "error" | "idle">(
    token ? "pending" : "idle",
  )
  const [message, setMessage] = useState(
    token ? "Deleting your account…" : "Open this page from the link in your email.",
  )

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void auth
      .confirmAccountDeletion(token)
      .then(async () => {
        if (cancelled) return
        setStatus("ok")
        setMessage("Your account has been deleted.")
        await router.invalidate()
      })
      .catch((e) => {
        if (cancelled) return
        setStatus("error")
        setMessage(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [token, router])

  return (
    <div
      data-pwid="delete-account-page"
      className="min-h-[60vh] flex items-center justify-center"
    >
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Delete account</h1>
        <p
          data-pwid={
            status === "ok"
              ? "delete-account-ok"
              : status === "error"
                ? "delete-account-error"
                : "delete-account-status"
          }
          className={`text-sm ${status === "error" ? "text-red-400" : "text-zinc-400"}`}
        >
          {message}
        </p>
        {status !== "pending" && (
          <Link
            data-pwid="delete-account-home"
            to="/"
            className="inline-block text-sm text-[var(--color-amber-accent)] hover:underline"
          >
            Back to home
          </Link>
        )}
      </div>
    </div>
  )
}
