import { useState } from "react"
import { Link, createFileRoute, useRouter, useRouterState } from "@tanstack/react-router"
import { auth, bands as bandsApi } from "~/api/client"
import { useAuth } from "~/components/AuthContext"
import { SignupForm } from "~/components/SignupForm"
import { SubmitButton, errorMessage } from "~/components/form"

export const Route = createFileRoute("/invitations/accept")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === "string" ? search.id : "",
    code: typeof search.code === "string" && search.code !== "" ? search.code : null,
  }),
  loaderDeps: ({ search }) => search,
  // Only an emailed invitation's link has a code, and only the code opens the preview.
  loader: ({ deps: { id, code } }) => (id && code ? auth.invitationPreview(id, code).catch(() => null) : null),
  component: AcceptInvitationPage,
})

/**
 * The page an invitation email links to. A signed-in invitee presses Accept;
 * the link's code, when it has one, goes with the request. A signed-out visitor
 * with an emailed link signs up here, as the invited address, and joins the
 * band in one step; one whose address already has an account signs in.
 */
function AcceptInvitationPage() {
  const { id, code } = Route.useSearch()
  const preview = Route.useLoaderData()
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
        <h1 data-pwid="accept-invitation-title" className="text-2xl font-bold tracking-tight">
          {preview ? `Join ${preview.band_name}` : "Band invitation"}
        </h1>

        {!id ? (
          <p data-pwid="accept-invitation-error" className="text-sm text-red-400">
            This invitation link is missing its id.
          </p>
        ) : user === null && code !== null && preview && !preview.has_account ? (
          <div className="space-y-4 text-left">
            <p className="text-center text-sm text-zinc-400">
              Create an account for <strong className="text-zinc-200">{preview.email}</strong> to join.
            </p>
            <SignupForm invitation={{ id, code, email: preview.email }} />
            <p className="text-center text-sm text-zinc-500">
              Already have an account?{" "}
              <Link
                data-pwid="accept-invitation-signin"
                to="/login"
                search={{ redirect: returnTo }}
                className="text-[var(--color-amber-accent)] hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
        ) : user === null ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              {code !== null && preview === null
                ? "This invitation link is no longer valid. Sign in to see your invitations."
                : "Sign in to accept this invitation."}
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
