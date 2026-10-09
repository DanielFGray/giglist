import { useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { auth } from "~/api/client"

export const Route = createFileRoute("/login")({
  component: Login,
})

function Login() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const form = new FormData(e.currentTarget)
    const id = form.get("id") as string
    const password = form.get("password") as string

    const result = await auth.login({ id, password })
    if (result.ok) {
      await router.invalidate()
      await router.navigate({ to: "/" })
    } else {
      setError(result.error)
    }
    setLoading(false)
  }

  return (
    <div data-pwid="login-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Welcome back to SetList
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div data-pwid="login-error" className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="id" className="block text-sm font-medium text-zinc-300">
              Username or email
            </label>
            <input
              data-pwid="login-id"
              id="id"
              name="id"
              type="text"
              required
              autoFocus
              autoComplete="username"
              className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
              Password
            </label>
            <input
              data-pwid="login-password"
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
            />
          </div>

          <button
            data-pwid="login-submit"
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[var(--color-amber-accent)] text-zinc-950 py-2 text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-zinc-500">
          Don't have an account?{" "}
          <Link data-pwid="login-to-signup" to="/signup" className="text-[var(--color-amber-accent)] hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
