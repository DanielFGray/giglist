import { Outlet, createRootRoute } from "@tanstack/react-router"
import { Nav } from "~/components/Nav"
import { AuthProvider } from "~/components/AuthContext"
import { auth, bands, type BandInfo } from "~/api/client"

export const Route = createRootRoute({
  loader: async () => {
    const [user, bandList] = await Promise.all([
      auth.me().catch(() => null),
      bands.list().catch(() => [] as BandInfo[]),
    ])
    return { user, bands: bandList }
  },
  component: RootComponent,
})

function RootComponent() {
  const { user, bands } = Route.useLoaderData()

  return (
    <div className="bg-[var(--color-surface)] text-zinc-100 antialiased min-h-screen [.light_&]:text-zinc-900">
      <AuthProvider user={user} bands={bands}>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-6">
          <Outlet />
        </main>
      </AuthProvider>
    </div>
  )
}
