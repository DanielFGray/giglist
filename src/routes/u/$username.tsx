import { useEffect } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { users } from "~/api/client"
import { UserPage } from "~/components/UserPage"

export const Route = createFileRoute("/u/$username")({
  loader: async ({ params }) => ({ profile: await users.publicProfile(params.username) }),
  component: PublicUserRoute,
})

/** A user's public profile (docs/adr/0011): their own theme, full-window like a band's page. */
function PublicUserRoute() {
  const { profile } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const title = profile ? (profile.name ?? profile.username) : "Profile not found"

  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])

  if (profile === null) {
    return (
      <div
        data-pwid="public-user-missing"
        className="min-h-[50vh] flex flex-col items-center justify-center gap-2 text-center"
      >
        <h1 className="text-2xl font-bold tracking-tight">Profile not found</h1>
        <p className="text-sm text-zinc-500">That public profile does not exist.</p>
      </div>
    )
  }

  const isMine = user !== null && user.username === profile.username

  return (
    <div className="[--stick-top:0px] fixed inset-0 z-50 bg-[var(--color-surface)]">
      <UserPage profile={profile} className="h-full" />
      {isMine && (
        <Link
          to="/settings"
          data-pwid="public-user-edit"
          className="absolute right-3 top-3 rounded-md bg-black/60 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-black/80"
        >
          Edit profile
        </Link>
      )}
    </div>
  )
}
