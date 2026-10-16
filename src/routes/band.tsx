import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/band")({
  // Band pages read band-scoped data and offer band mutations, so a signed-out
  // visitor is sent to sign in rather than shown a form that would 4xx.
  beforeLoad: ({ context }) => {
    if (context.user === null) {
      throw redirect({ to: "/login" })
    }
  },
  component: BandLayout,
  errorComponent: BandError,
})

function BandLayout() {
  return <Outlet />
}

/** A loader failure reaches here, inside the root layout, so the nav stays put
 *  while the band's page reports what went wrong. */
function BandError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div data-pwid="band-error" className="min-h-[40vh] flex flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Could not load this band</h1>
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
  )
}
