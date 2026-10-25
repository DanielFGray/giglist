import { useState } from "react"
import { Link, createFileRoute, useRouter, useRouterState } from "@tanstack/react-router"
import { bands as bandsApi } from "~/api/client"
import { useAuth } from "~/components/AuthContext"
import { SubmitButton, errorMessage } from "~/components/form"

export const Route = createFileRoute("/invitations/accept")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === "string" ? search.id : "",
    code: typeof search.code === "string" && search.code !== "" ? search.code : null,
  }),
  component: AcceptInvitationPage,
})

/**
 * The page an invitation email links to. The invitee must be signed in to accept.
 * The link's code, when it has one, goes with the accept request; nothing is
 * accepted until the invitee presses the button.
 */
function AcceptInvitationPage() {
  const { id, code } = Route.useSearch()
  const { user } = useAuth()
  const router = useRouter()
  const returnTo = useRouterState({
    select: (state) => `${state.location.pathname}${state.location.searchStr}`,
  })
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const accept = async () => {
    setServerError(null)
    setPending(true)
    try {
      const { bandId } = await bandsApi.acceptInvitation(id, code)
      await router.invalidate()
      await router.navigate({ to: "/band/$bandId", params: { bandId } })
    } catch (error) {
      setServerError(errorMessage(error))
      setPending(false)
    }
  }

  return (
    <div data-pwid="accept-invitation-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Band invitation</h1>

        {!id ? (
          <p data-pwid="accept-invitation-error" className="text-sm text-red-400">
            This invitation link is missing its id.
          </p>
        ) : user === null ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Sign in to accept this invitation.
            </p>
            <Link
              data-pwid="accept-invitation-signin"
              to="/login"
              search={{ redirect: returnTo }}
              className="inline-block text-sm text-[var(--color-amber-accent)] hover:underline"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void accept()
            }}
            className="space-y-4"
          >
            {serverError && (
              <div
                data-pwid="accept-invitation-error"
                className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400"
              >
                {serverError}
              </div>
            )}
            <SubmitButton
              pwid="accept-invitation-submit"
              disabled={pending}
              pending={pending}
              label="Accept invitation"
              pendingLabel="Accepting…"
              wide
            />
          </form>
        )}
      </div>
    </div>
  )
}
