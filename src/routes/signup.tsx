import { useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { registerFn } from "~/server/auth.fn"

export const Route = createFileRoute("/signup")({
  component: Signup,
})

function Signup() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const form = new FormData(e.currentTarget)
    const username = form.get("username") as string
    const email = form.get("email") as string
    const password = form.get("password") as string

    const result = await registerFn({ data: { username, email, password } })
    if (result.ok) {
      await router.invalidate()
      await router.navigate({ to: "/" })
    } else {
      setError(result.error)
    }
    setLoading(false)
  }

  return (
    <div data-pwid="signup-page" className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Get your band on SetList
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div data-pwid="signup-error" className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="username" className="block text-sm font-medium text-zinc-300">
              Username
            </label>
            <input
              data-pwid="signup-username"
              id="username"
              name="username"
              type="text"
              required
              autoFocus
              autoComplete="username"
              className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
              placeholder="hendrix42"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
              Email
            </label>
            <input
              data-pwid="signup-email"
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
              Password
            </label>
            <input
              data-pwid="signup-password"
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-[var(--color-amber-accent)] transition-colors"
            />
          </div>

          <button
            data-pwid="signup-submit"
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[var(--color-amber-accent)] text-zinc-950 py-2 text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link data-pwid="signup-to-login" to="/login" className="text-[var(--color-amber-accent)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
