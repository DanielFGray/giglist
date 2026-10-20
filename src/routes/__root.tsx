import { Outlet, createRootRoute } from "@tanstack/react-router"
import { Nav } from "~/components/Nav"
import { AuthProvider } from "~/components/AuthContext"
import { auth, bands } from "~/api/client"

export const Route = createRootRoute({
  /**
   * Load the session here and return it as route context, not as loader data:
   * a child route can then guard on it before it loads. The band routes send a
   * signed-out visitor to the login page.
   *
   * Errors deliberately reach the router: a failed load must not look like
   * "no bands", which is what the band page renders forever.
   */
  beforeLoad: async () => {
    const [user, bandList] = await Promise.all([auth.me(), bands.list()])
    return { user, bands: bandList }
  },
  errorComponent: ({ error, reset }) => (
    <div data-pwid="root-error" className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Could not load GigList</h1>
      <p className="text-sm text-zinc-500 max-w-md">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-md bg-[var(--color-amber-accent)] text-zinc-950 text-sm font-semibold hover:brightness-110 transition cursor-pointer"
      >
        Try again
      </button>
    </div>
  ),
  component: RootComponent,
})

function RootComponent() {
  const { user, bands } = Route.useRouteContext()

  return (
    <div className="bg-[var(--color-surface)] text-zinc-100 antialiased min-h-screen [.light_&]:text-zinc-900">
      <AuthProvider user={user} bands={bands}>
        <Nav />
        <main className="mx-auto max-w-6xl lg:has-[[data-wide]]:max-w-none px-4 py-6 [--stick-top:calc(3.5rem+1px)] [html[data-nav=hidden]_&]:[--stick-top:0px]">
          <Outlet />
        </main>
      </AuthProvider>
    </div>
  )
}
